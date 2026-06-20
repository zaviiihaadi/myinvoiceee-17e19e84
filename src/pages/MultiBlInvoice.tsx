import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, FileSpreadsheet, FileText, CheckCircle2,
  Loader2, Layers, ShieldCheck, Sparkles, Lightbulb, Trash2, UploadCloud, Upload,
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

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

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

  const [excelRows, setExcelRows] = useState<ExcelRow[]>([]);
  const [excelFileName, setExcelFileName] = useState<string | null>(null);
  const [excelFileSize, setExcelFileSize] = useState<number | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateLayout, setTemplateLayout] = useState<any | null>(null);
  const [extractingTemplate, setExtractingTemplate] = useState(false);
  const templateInputRef = useRef<HTMLInputElement>(null);

  const excelStorageKey = user?.id ? `invoice-excel:${user.id}` : null;
  const excelMetaKey = user?.id ? `invoice-excel-meta:${user.id}` : null;
  const templateStorageKey = user?.id ? `invoice-template:${user.id}` : null;

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [authLoading, user, navigate]);

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
      if (excelMetaKey) {
        const meta = window.localStorage.getItem(excelMetaKey);
        if (meta) {
          const m = JSON.parse(meta);
          if (typeof m?.size === 'number') setExcelFileSize(m.size);
        }
      }
    } catch (e) {
      console.error('Restore excel failed:', e);
    }
  }, [excelStorageKey, excelMetaKey]);

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
      setExcelFileSize(file.size);
      if (excelStorageKey) {
        window.localStorage.setItem(excelStorageKey, JSON.stringify({ rows, fileName: file.name }));
      }
      if (excelMetaKey) {
        window.localStorage.setItem(excelMetaKey, JSON.stringify({ size: file.size }));
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
    setExcelFileSize(null);
    if (excelStorageKey) window.localStorage.removeItem(excelStorageKey);
    if (excelMetaKey) window.localStorage.removeItem(excelMetaKey);
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/40">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Top header row */}
        <div className="flex items-start sm:items-center justify-between gap-3 mb-6 sm:mb-8 flex-wrap">
          <div className="flex items-center gap-3 sm:gap-5">
            <button
              onClick={() => navigate('/invoice-home')}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all text-sm font-medium text-slate-700"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <div className="hidden sm:flex items-center gap-4">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30"
              >
                <Layers className="w-7 h-7" />
              </motion.div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                  Multi-BL Invoice
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Process up to <span className="font-semibold text-slate-700">10 Bill of Lading files</span> in one batch — each runs the exact Single-BL workflow.
                </p>
              </div>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/70 backdrop-blur border border-indigo-100 shadow-sm"
          >
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-slate-800 flex items-center gap-1">
                State preserved across refresh
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div className="text-xs text-slate-500">Your files and selections are safe</div>
            </div>
          </motion.div>
        </div>

        {/* Mobile title (hidden on sm+) */}
        <div className="sm:hidden mb-6 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Multi-BL Invoice</h1>
            <p className="text-xs text-slate-500">Up to 10 BL files per batch</p>
          </div>
        </div>

        {/* Two compact glassmorphism cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          {/* Excel card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            whileHover={{ y: -3, scale: 1.005 }}
            className={`relative rounded-2xl overflow-hidden backdrop-blur-xl transition-all duration-500 ${
              excelReady
                ? 'bg-gradient-to-br from-emerald-500 via-green-500 to-teal-500 border border-emerald-300/50 shadow-[0_10px_30px_-8px_rgba(16,185,129,0.55)]'
                : 'bg-white/70 border border-emerald-100 shadow-[0_4px_20px_-8px_rgba(16,185,129,0.18)]'
            }`}
          >
            {excelReady && (
              <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(circle_at_top_right,_white,_transparent_60%)]" />
            )}
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelUpload}
              className="hidden"
            />
            <div className="relative p-4 sm:p-5">
              {!excelReady ? (
                <div className="flex items-center gap-3.5">
                  <motion.div
                    whileHover={{ rotate: -8, scale: 1.08 }}
                    className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-green-500 text-white flex items-center justify-center shadow-md shrink-0"
                  >
                    <FileSpreadsheet className="w-6 h-6" />
                  </motion.div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">Excel Auto Fill</h3>
                    <p className="text-xs text-slate-500 leading-tight mt-0.5">Upload company price mapping</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => !excelLoading && excelInputRef.current?.click()}
                    disabled={excelLoading}
                    className="h-9 px-3 rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-md shrink-0 gap-1.5"
                  >
                    {excelLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">Upload</span>
                  </Button>
                </div>
              ) : (
                <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-3 text-white">
                  <motion.div
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                    className="w-12 h-12 rounded-xl bg-white/25 backdrop-blur flex items-center justify-center shrink-0 ring-2 ring-white/40"
                  >
                    <CheckCircle2 className="w-7 h-7" strokeWidth={2.5} />
                  </motion.div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-tight flex items-center gap-1.5">
                      Excel Uploaded
                      <Sparkles className="w-3.5 h-3.5" />
                    </p>
                    <p className="text-xs text-white/90 truncate" title={excelFileName || ''}>{excelFileName}</p>
                    <p className="text-[11px] text-white/80 mt-0.5">
                      {excelFileSize ? formatBytes(excelFileSize) : `${excelRows.length} rows`} · {excelRows.length} rows
                    </p>
                  </div>
                  <button
                    onClick={removeExcel}
                    className="w-9 h-9 rounded-lg bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors shrink-0 backdrop-blur"
                    aria-label="Remove Excel"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>

          {/* Template card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            whileHover={{ y: -3, scale: 1.005 }}
            className={`relative rounded-2xl overflow-hidden backdrop-blur-xl transition-all duration-500 ${
              templateReady
                ? 'bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 border border-violet-300/50 shadow-[0_10px_30px_-8px_rgba(139,92,246,0.55)]'
                : 'bg-white/70 border border-purple-100 shadow-[0_4px_20px_-8px_rgba(139,92,246,0.18)]'
            }`}
          >
            {templateReady && (
              <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(circle_at_top_left,_white,_transparent_60%)]" />
            )}
            <input
              ref={templateInputRef}
              type="file"
              accept=".pdf,.docx,.doc"
              onChange={handleTemplateUpload}
              className="hidden"
            />
            <div className="relative p-4 sm:p-5">
              {!templateReady ? (
                <div className="flex items-center gap-3.5">
                  <motion.div
                    whileHover={{ rotate: 8, scale: 1.08 }}
                    className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white flex items-center justify-center shadow-md shrink-0"
                  >
                    <FileText className="w-6 h-6" />
                  </motion.div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">Invoice Template</h3>
                    <p className="text-xs text-slate-500 leading-tight mt-0.5">Upload invoice template</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => !extractingTemplate && templateInputRef.current?.click()}
                    disabled={extractingTemplate}
                    className="h-9 px-3 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white shadow-md shrink-0 gap-1.5"
                  >
                    {extractingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">Upload</span>
                  </Button>
                </div>
              ) : (
                <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-3 text-white">
                  <motion.div
                    initial={{ scale: 0, rotate: 90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                    className="w-12 h-12 rounded-xl bg-white/25 backdrop-blur flex items-center justify-center shrink-0 ring-2 ring-white/40"
                  >
                    <CheckCircle2 className="w-7 h-7" strokeWidth={2.5} />
                  </motion.div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-tight flex items-center gap-1.5">
                      Template Ready
                      <Sparkles className="w-3.5 h-3.5" />
                    </p>
                    <p className="text-xs text-white/90 truncate" title={templateFile!.name}>{templateFile!.name}</p>
                    <p className="text-[11px] text-white/80 mt-0.5">
                      {formatBytes(templateFile!.size)}{templateLayout ? ' · AI mapped' : ''}{extractingTemplate ? ' · mapping…' : ''}
                    </p>
                  </div>
                  <button
                    onClick={removeTemplate}
                    className="w-9 h-9 rounded-lg bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors shrink-0 backdrop-blur"
                    aria-label="Remove template"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>

        {/* Info alert */}
        {!excelReady && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50/60 px-4 py-3 flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
              <Lightbulb className="w-5 h-5" />
            </div>
            <p className="text-sm text-amber-800 flex-1">
              Upload an Excel file above to enable container matching for Multi-BL.
            </p>
          </motion.div>
        )}

        {/* Bulk BL upload (existing component reused — same workflow) */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
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

void cleanContainerNumber;
