import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, FileSpreadsheet, FileText, Package, X, CheckCircle2,
  Loader2, Upload, Sparkles, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { Header } from '@/components/Header';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { BulkBlUpload } from '@/components/BulkBlUpload';
import {
  loadPersistedInvoiceTemplate,
  savePersistedInvoiceTemplate,
  removePersistedInvoiceTemplate,
  cleanContainerNumber,
} from '@/pages/InvoiceGenerator';

interface ExcelRow {
  container: string;
  invoice: string;
  price: string;
}

const readFileAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

// Excel parser — identical column detection to InvoiceGenerator.handleExcelUpload
async function parseExcelFile(file: File): Promise<ExcelRow[]> {
  const name = file.name.toLowerCase();
  const isCsv = name.endsWith('.csv');
  const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls');
  if (!isCsv && !isXlsx) throw new Error('Please upload .xlsx, .xls or .csv file.');

  let rows: string[][] = [];
  if (isCsv) {
    const text = await file.text();
    rows = text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((line) => {
        const out: string[] = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQ = !inQ; continue; }
          if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
          cur += ch;
        }
        out.push(cur);
        return out.map((c) => c.trim());
      });
  } else {
    const ExcelJS = await import('exceljs');
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (ws) {
      ws.eachRow((row) => {
        const arr: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          const v = cell.value as any;
          if (v === null || v === undefined) { arr.push(''); return; }
          if (typeof v === 'object') {
            if ('text' in v && typeof v.text === 'string') { arr.push(v.text); return; }
            if ('richText' in v && Array.isArray(v.richText)) {
              arr.push((v.richText as { text: string }[]).map((r) => r.text).join(''));
              return;
            }
            if ('result' in v) { arr.push(String(v.result ?? '')); return; }
          }
          arr.push(String(v));
        });
        rows.push(arr.map((c) => (c ?? '').toString().trim()));
      });
    }
  }
  if (rows.length === 0) throw new Error('Excel file is empty.');

  const header = rows[0].map((h) => h.toLowerCase());
  const findCol = (keywords: string[]) =>
    header.findIndex((h) => keywords.some((k) => h.includes(k)));
  let containerCol = findCol(['container']);
  let invoiceCol = findCol(['invoice']);
  let priceCol = findCol(['company price', 'total amount', 'total price', 'amount', 'price']);
  let dataStart = 1;
  if (containerCol === -1 && invoiceCol === -1 && priceCol === -1) {
    containerCol = 0; invoiceCol = 1; priceCol = 2;
    dataStart = 0;
  }
  const parsed: ExcelRow[] = [];
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i];
    const container = containerCol >= 0 ? (r[containerCol] || '') : '';
    const invoice = invoiceCol >= 0 ? (r[invoiceCol] || '') : '';
    const price = priceCol >= 0 ? (r[priceCol] || '') : '';
    if (!container && !invoice && !price) continue;
    parsed.push({ container, invoice, price });
  }
  if (parsed.length === 0) throw new Error('No data rows found in Excel.');
  return parsed;
}

export default function MultiBlInvoice() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  // Shared Excel (persisted in localStorage — same key as Single BL)
  const [excelRows, setExcelRows] = useState<ExcelRow[]>([]);
  const [excelFileName, setExcelFileName] = useState<string | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // Shared Template (persisted in IndexedDB — same store as Single BL)
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateLayout, setTemplateLayout] = useState<any | null>(null);
  const [extractingTemplate, setExtractingTemplate] = useState(false);
  const templateInputRef = useRef<HTMLInputElement>(null);

  const excelStorageKey = user?.id ? `invoice-excel:${user.id}` : null;
  const templateStorageKey = user?.id ? `invoice-template:${user.id}` : null;

  // Auth gate
  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [authLoading, user, navigate]);

  // Restore Excel
  useEffect(() => {
    if (!excelStorageKey) return;
    try {
      const raw = window.localStorage.getItem(excelStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { rows: ExcelRow[]; fileName: string | null };
      if (Array.isArray(parsed?.rows) && parsed.rows.length > 0) {
        setExcelRows(parsed.rows);
        setExcelFileName(parsed.fileName ?? null);
      }
    } catch (e) {
      console.error('Restore excel failed:', e);
    }
  }, [excelStorageKey]);

  // Restore Template
  useEffect(() => {
    if (!templateStorageKey) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadPersistedInvoiceTemplate(templateStorageKey);
        if (!saved || cancelled) return;
        const restored = new File([saved.blob], saved.name, {
          type: saved.type,
          lastModified: Date.now(),
        });
        setTemplateFile(restored);
        setTemplateLayout(saved.layout ?? null);
      } catch (e) {
        console.error('Restore template failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [templateStorageKey]);

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    setExcelLoading(true);
    try {
      const rows = await parseExcelFile(file);
      setExcelRows(rows);
      setExcelFileName(file.name);
      if (excelStorageKey) {
        window.localStorage.setItem(excelStorageKey, JSON.stringify({ rows, fileName: file.name }));
      }
      toast.success(`Excel loaded — ${rows.length} rows ready.`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load Excel.');
    } finally {
      setExcelLoading(false);
    }
  };

  const removeExcel = () => {
    setExcelRows([]);
    setExcelFileName(null);
    if (excelStorageKey) window.localStorage.removeItem(excelStorageKey);
    toast.message('Excel removed.');
  };

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    const name = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isDocx = name.endsWith('.docx') || name.endsWith('.doc') ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!isPdf && !isDocx) {
      toast.error('Template must be PDF, DOCX or DOC.');
      return;
    }
    setTemplateFile(file);

    if (isDocx) {
      setTemplateLayout(null);
      if (templateStorageKey) {
        try {
          await savePersistedInvoiceTemplate(templateStorageKey, {
            blob: file, layout: null, name: file.name, type: file.type,
          });
        } catch (err) { console.error(err); }
      }
      toast.success('Word template ready — Adobe API will merge tags.');
      return;
    }

    setExtractingTemplate(true);
    let extractedLayout: any | null = null;
    try {
      const base64 = await readFileAsBase64(file);
      const { data, error } = await supabase.functions.invoke('extract-template-layout', {
        body: { fileBase64: base64, mimeType: file.type },
      });
      if (error) throw error;
      extractedLayout = data;
      setTemplateLayout(data);
      toast.success('PDF template mapped — overlay ready.');
    } catch (err: any) {
      setTemplateLayout(null);
      toast.warning(err?.message || 'Template AI mapping failed. Fallback layout will be used.');
    } finally {
      if (templateStorageKey) {
        try {
          await savePersistedInvoiceTemplate(templateStorageKey, {
            blob: file, layout: extractedLayout, name: file.name, type: file.type,
          });
        } catch (err) { console.error(err); }
      }
      setExtractingTemplate(false);
    }
  };

  const removeTemplate = async () => {
    setTemplateFile(null);
    setTemplateLayout(null);
    if (templateStorageKey) {
      try { await removePersistedInvoiceTemplate(templateStorageKey); } catch (e) { console.error(e); }
    }
    toast.message('Template removed.');
  };

  if (authLoading || !user) return <div className="min-h-screen bg-background" />;

  const excelReady = excelRows.length > 0;
  const templateReady = !!templateFile;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-indigo-500/[0.03]">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Top bar with Back button */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/invoice-home')}
            className="gap-2 -ml-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div className="text-xs text-muted-foreground hidden sm:flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            State preserved across refresh
          </div>
        </div>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
              <Layers className="w-7 h-7" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Multi-BL Invoice
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground mt-1">
                Process up to <span className="font-semibold text-foreground">10 Bill of Lading files</span> in one batch — each runs the exact Single-BL workflow.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mb-5">
          {/* Card 1 — Excel */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card className="border-border/60 shadow-sm overflow-hidden h-full">
              <CardHeader className="bg-gradient-to-r from-emerald-500/8 to-transparent">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      Excel Auto-Fill
                      {excelReady && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Shared with Single BL. Persists across refresh.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-5">
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleExcelUpload}
                  className="hidden"
                />
                {excelReady ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate">{excelFileName || 'Excel data'}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {excelRows.length} rows loaded
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={removeExcel} className="text-destructive hover:text-destructive shrink-0">
                        <X className="w-4 h-4 mr-1" /> Remove
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => !excelLoading && excelInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all"
                  >
                    {excelLoading ? (
                      <Loader2 className="w-8 h-8 text-muted-foreground mx-auto mb-2 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    )}
                    <p className="text-sm font-medium text-foreground">Click to upload Excel</p>
                    <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .csv</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Card 2 — Template */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="border-border/60 shadow-sm overflow-hidden h-full">
              <CardHeader className="bg-gradient-to-r from-purple-500/8 to-transparent">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      Invoice Template
                      {templateReady && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      PDF, DOCX or DOC. Persists across refresh.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-5">
                <input
                  ref={templateInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc"
                  onChange={handleTemplateUpload}
                  className="hidden"
                />
                {templateReady ? (
                  <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate">{templateFile!.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {extractingTemplate ? 'Mapping fields…' : templateLayout ? 'AI fields mapped' : 'Adobe merge tags'}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={removeTemplate} className="text-destructive hover:text-destructive shrink-0">
                        <X className="w-4 h-4 mr-1" /> Remove
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => !extractingTemplate && templateInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-purple-500/50 hover:bg-purple-500/5 transition-all"
                  >
                    {extractingTemplate ? (
                      <Loader2 className="w-8 h-8 text-muted-foreground mx-auto mb-2 animate-spin" />
                    ) : (
                      <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    )}
                    <p className="text-sm font-medium text-foreground">Click to upload template</p>
                    <p className="text-xs text-muted-foreground mt-1">PDF / DOCX / DOC</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Card 3 — Multi BL Upload (reuses BulkBlUpload — same Single-BL workflow) */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          {!excelReady && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
              Upload an Excel file above to enable container matching for Multi-BL.
            </div>
          )}
          <BulkBlUpload
            excelRows={excelRows}
            templateFile={templateFile}
            templateLayout={templateLayout}
          />
        </motion.div>
      </main>
    </div>
  );
}

// keep import side-effect to avoid tree-shaking warnings on cleanContainerNumber re-export use
void cleanContainerNumber;
