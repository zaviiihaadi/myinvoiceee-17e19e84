import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, FileSpreadsheet, FileText, X, CheckCircle2,
  Loader2, Layers, ShieldCheck, Sparkles, Lightbulb, Trash2, UploadCloud,
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

        {/* Two upload cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          {/* Excel card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            whileHover={{ y: -2 }}
            className="rounded-2xl bg-white border border-emerald-100 shadow-[0_4px_24px_-12px_rgba(16,185,129,0.25)] overflow-hidden"
          >
            <div className="p-5 sm:p-6 bg-gradient-to-br from-emerald-50/80 to-transparent">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-sm">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-emerald-700">Excel Auto-Fill</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Shared with Single BL. Persists across refresh.</p>
                  </div>
                </div>
                {excelReady && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Uploaded
                  </span>
                )}
              </div>

              <input
                ref={excelInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleExcelUpload}
                className="hidden"
              />

              <div
                onClick={() => !excelLoading && excelInputRef.current?.click()}
                className="border-2 border-dashed border-emerald-200 rounded-xl p-6 sm:p-8 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/50 transition-all bg-white/60"
              >
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white border border-emerald-200 flex items-center justify-center shadow-sm">
                  {excelLoading ? (
                    <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
                  ) : (
                    <UploadCloud className="w-5 h-5 text-emerald-500" />
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-700">Click to upload Excel</p>
                <p className="text-xs text-slate-400 mt-1">.xlsx, .xls, .csv</p>
              </div>

              {excelReady && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-white border border-emerald-100"
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{excelFileName}</p>
                    <p className="text-xs text-slate-400">{excelFileSize ? formatBytes(excelFileSize) : `${excelRows.length} rows`}</p>
                  </div>
                  <button
                    onClick={removeExcel}
                    className="w-9 h-9 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition-colors shrink-0"
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
            whileHover={{ y: -2 }}
            className="rounded-2xl bg-white border border-purple-100 shadow-[0_4px_24px_-12px_rgba(139,92,246,0.25)] overflow-hidden"
          >
            <div className="p-5 sm:p-6 bg-gradient-to-br from-purple-50/80 to-transparent">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center shadow-sm">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-purple-700">Invoice Template</h3>
                    <p className="text-xs text-slate-500 mt-0.5">PDF, DOCX or DOC. Persists across refresh.</p>
                  </div>
                </div>
                {templateReady && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Uploaded
                  </span>
                )}
              </div>

              <input
                ref={templateInputRef}
                type="file"
                accept=".pdf,.docx,.doc"
                onChange={handleTemplateUpload}
                className="hidden"
              />

              <div
                onClick={() => !extractingTemplate && templateInputRef.current?.click()}
                className="border-2 border-dashed border-purple-200 rounded-xl p-6 sm:p-8 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 transition-all bg-white/60"
              >
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white border border-purple-200 flex items-center justify-center shadow-sm">
                  {extractingTemplate ? (
                    <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                  ) : (
                    <UploadCloud className="w-5 h-5 text-purple-500" />
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-700">Click to upload template</p>
                <p className="text-xs text-slate-400 mt-1">PDF / DOCX / DOC</p>
              </div>

              {templateReady && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-white border border-purple-100"
                >
                  <div className="w-9 h-9 rounded-lg bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{templateFile!.name}</p>
                    <p className="text-xs text-slate-400">
                      {extractingTemplate
                        ? 'Mapping fields…'
                        : `${formatBytes(templateFile!.size)}${templateLayout ? ' · AI mapped' : ''}`}
                    </p>
                  </div>
                  <button
                    onClick={removeTemplate}
                    className="w-9 h-9 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition-colors shrink-0"
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
