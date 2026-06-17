import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Upload, Loader2, CheckCircle2, X, Download, AlertCircle, UploadCloud,
  FileText, Brain, Link2, Calculator, FileCheck2, Info, Share2, Copy,
  Play, Trash2, BarChart3, Eye, Clock, XCircle, FileIcon, Package, ArrowLeft,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  cleanContainerNumber,
  cleanContainerList,
  resolveTemplateLayout,
  parseExactAmountInput,
  normalizeDecimalForMath,
  multiplyDecimalStrings,
  formatCalculatedDecimal,
  normalizeDateString,
  todayDDMMYY,
} from '@/pages/InvoiceGenerator';

const MAX_BULK_FILES = 10;
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

interface ExcelRow {
  container: string;
  invoice: string;
  price: string;
}

interface BulkBlUploadProps {
  excelRows: ExcelRow[];
  templateFile: File | null;
  templateLayout: any | null;
}

type BulkStatus = 'pending' | 'processing' | 'matched' | 'no_match' | 'failed' | 'done';

interface BulkBlItem {
  id: string;
  file: File;
  status: BulkStatus;
  message?: string;
  containerNumber?: string;
  blNumber?: string;
  invoiceNumber?: string;
  companyPrice?: string;
  weight?: number;
  blData?: any;
  pdfBase64?: string;
  progress?: number;
  uploadedAt?: number;
  extractedAt?: number;
  generatedAt?: number;
  nocAt?: number;
}

const normalizeKey = (s: string) =>
  (s || '').toString().toUpperCase().replace(/[\s\-_.,:;#'"]/g, '');

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '');

// Mirrors the single-BL normalization performed in InvoiceGenerator.extractBLData
function normalizeExtractedBlData(raw: any) {
  const notifyName = (raw?.notify_party || '').trim();
  const notifyAddr = (raw?.notify_party_address || '').trim();
  const notifyAlreadyHasAddr = notifyAddr && notifyName.toLowerCase().includes(notifyAddr.toLowerCase());
  const mergedNotify = notifyAlreadyHasAddr || !notifyAddr
    ? notifyName
    : [notifyName, notifyAddr].filter(Boolean).join('\n');

  let cleanedDescription = (raw?.description || '').trim();
  if (cleanedDescription) {
    const match = cleanedDescription.match(/(MIX(?:ED)?\s+USED\s+CLOTHING|USED\s+CLOTHING)[\s\S]*/i);
    if (match) cleanedDescription = match[0].trim();
    cleanedDescription = cleanedDescription
      .replace(/^SAID\s+TO\s+CONTAIN[^A-Za-z]*\d*\s*X?\s*\d*[A-Z0-9]*\s*\d*\s*BALES?\s*[:\-]?\s*/i, '')
      .trim();
  }

  return {
    ...raw,
    container_numbers: cleanContainerList(raw?.container_numbers),
    notify_party: mergedNotify,
    notify_party_address: '',
    description: cleanedDescription,
  };
}

// Mirrors the single-BL calculateValues() exactly (same truncation + 0.42 floor + 3dp total)
function singleBlCalculate(blData: any, companyPriceStr: string) {
  if (!blData?.kgs || !companyPriceStr) return null;
  const parsedAmount = parseExactAmountInput(companyPriceStr);
  if (!parsedAmount) return null;
  const normalizedWeight = normalizeDecimalForMath(String(blData.kgs));
  if (!normalizedWeight) return null;

  const companyPriceNum = Number(parsedAmount.normalizedForMath);
  const weightNum = Number(normalizedWeight);
  if (!isFinite(companyPriceNum) || !isFinite(weightNum) || weightNum === 0) return null;

  const rawUnitPrice = companyPriceNum / weightNum;
  const truncatedUnitPrice = Math.floor(rawUnitPrice * 100) / 100;
  const unitPriceNum = truncatedUnitPrice < 0.42 ? 0.42 : truncatedUnitPrice;
  const unitPriceText = unitPriceNum.toFixed(2);

  const computedTotalRaw =
    multiplyDecimalStrings(unitPriceText, normalizedWeight, 3) ?? parsedAmount.normalized;
  const totalPriceText = formatCalculatedDecimal(computedTotalRaw, 3);

  return {
    unitPrice: unitPriceNum,
    unitPriceText,
    totalPriceText,
    kgs: blData.kgs as number,
  };
}

export function BulkBlUpload({ excelRows, templateFile, templateLayout }: BulkBlUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BulkBlItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [viewItem, setViewItem] = useState<BulkBlItem | null>(null);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = '';
    if (files.length === 0) return;
    if (files.length > MAX_BULK_FILES) {
      toast.error(`Maximum ${MAX_BULK_FILES} BL files at one time.`);
      return;
    }
    const invalid = files.find((f) => !ACCEPTED_TYPES.includes(f.type));
    if (invalid) {
      toast.error('Only PDF, JPG, JPEG, PNG allowed.');
      return;
    }
    setItems((prev) => {
      const merged = [
        ...prev,
        ...files.map((f, i) => ({
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          file: f,
          status: 'pending' as BulkStatus,
          progress: 0,
          uploadedAt: Date.now(),
        })),
      ];
      if (merged.length > MAX_BULK_FILES) {
        toast.error(`Maximum ${MAX_BULK_FILES} files total.`);
        return merged.slice(0, MAX_BULK_FILES);
      }
      return merged;
    });
  };

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((x) => x.id !== id));

  const clearAll = () => setItems([]);

  const updateItem = (id: string, patch: Partial<BulkBlItem>) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const processBL = async (item: BulkBlItem): Promise<BulkBlItem> => {
    try {
      updateItem(item.id, { status: 'processing', message: 'Uploading file…', progress: 25, uploadedAt: Date.now() });

      // 1. AI Extraction (same edge function as single BL)
      const base64 = await readBase64(item.file);
      updateItem(item.id, { progress: 35, message: 'AI extracting…' });
      const { data: rawData, error } = await supabase.functions.invoke('extract-bl-data', {
        body: { fileBase64: base64, mimeType: item.file.type },
      });
      if (error) throw error;
      updateItem(item.id, { progress: 50, message: 'Data extracted', extractedAt: Date.now() });

      // 2. Same normalization as single BL (containers + notify party + description)
      const blData = normalizeExtractedBlData(rawData);
      const containers: string[] = blData.container_numbers || [];
      const containerNumber = containers[0] || '';
      const blNumber = (blData?.bl_number || '').trim();
      const weight = Number(blData?.kgs);

      // 3. Same Excel matching logic as single BL (tryAutoFillFromExcel)
      const keys = containers
        .map((c) => cleanContainerNumber(c) || normalizeKey(c))
        .filter(Boolean);
      const matched = excelRows.find((row) => {
        const k = cleanContainerNumber(row.container) || normalizeKey(row.container);
        return keys.includes(k);
      });

      if (!matched) {
        const failed: BulkBlItem = {
          ...item,
          status: 'no_match',
          message: 'No Excel match',
          containerNumber,
          blNumber,
          blData,
          weight: isFinite(weight) ? weight : undefined,
          progress: 100,
        };
        updateItem(item.id, failed);
        return failed;
      }

      // 4. Same calculation as single BL (calculateValues)
      const calc = singleBlCalculate(blData, matched.price);
      if (!calc) {
        const failed: BulkBlItem = {
          ...item,
          status: 'failed',
          message: 'Missing weight/price',
          containerNumber,
          blNumber,
          invoiceNumber: matched.invoice,
          companyPrice: matched.price,
          blData,
          progress: 100,
        };
        updateItem(item.id, failed);
        return failed;
      }

      // 5. Same field resolution as single BL (matched.invoice -> blData.bl_number fallback handled via state in single)
      const invNum = matched.invoice || blNumber || `INV-${Date.now()}`;
      const invoiceDate = blData?.bl_date ? normalizeDateString(blData.bl_date) : todayDDMMYY();
      const containerNums = containers.join(', ');
      const firstContainer = containerNumber;
      const containerSize = blData?.container_size || '';
      const bales = blData?.bales || '';

      // 6. Identical Adobe merge tags payload as single BL
      const adobeData = {
        invoice_number: invNum,
        date: invoiceDate,
        shipper: blData?.shipper || '',
        shipper_address: blData?.shipper_address || '',
        consignee: blData?.consignee || '',
        consignee_address: blData?.consignee_address || '',
        notify_party: blData?.notify_party || blData?.consignee || '',
        notify_party_address: blData?.notify_party_address || blData?.consignee_address || '',
        container_size: containerSize,
        container_numbers: containerNums,
        container_numbers_one: firstContainer,
        vessel: blData?.vessel_name || '',
        port_of_loading: blData?.port_of_loading || '',
        port_of_discharge: blData?.port_of_discharge || '',
        hs_code: blData?.hs_code || '',
        goods_description: blData?.description || '',
        gross_weight: `${calc.kgs}KGS`,
        unit_price: `${calc.unitPriceText}US$ Per KG`,
        amount: `${calc.totalPriceText}$`,
        shipping_marks: blData?.shipping_marks || 'NIL',
        packages: bales ? `${bales} BALES` : (blData?.packages || ''),
        company_name: blData?.shipper || '',
      };

      updateItem(item.id, {
        status: 'processing',
        message: 'Generating invoice…',
        containerNumber,
        blNumber,
        invoiceNumber: invNum,
        companyPrice: matched.price,
        weight,
        progress: 75,
      });

      // 7. Same template routing as single BL (overlay for PDF, Adobe for DOCX/built-in)
      const tplName = (templateFile?.name || '').toLowerCase();
      const isUserPdf =
        templateFile && (templateFile.type === 'application/pdf' || tplName.endsWith('.pdf'));
      const isUserDocx =
        templateFile &&
        (tplName.endsWith('.docx') ||
          tplName.endsWith('.doc') ||
          templateFile.type ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

      let pdfBase64: string | undefined;
      if (isUserPdf) {
        const overlayData = {
          ...adobeData,
          shipper: [blData?.shipper, blData?.shipper_address].filter(Boolean).join('\n'),
          consignee: [blData?.consignee, blData?.consignee_address].filter(Boolean).join('\n'),
          notify_party: [
            blData?.notify_party || blData?.consignee,
            blData?.notify_party_address || blData?.consignee_address,
          ]
            .filter(Boolean)
            .join('\n'),
        };
        const templateBase64 = await readBase64(templateFile!);
        const resolved = resolveTemplateLayout(templateLayout);
        const { data: res, error: err } = await supabase.functions.invoke('generate-invoice-overlay', {
          body: { templateBase64, data: overlayData, fields: resolved.fields ?? [] },
        });
        if (err) throw err;
        if (!res?.success) throw new Error(res?.error || 'PDF overlay failed');
        pdfBase64 = res.pdfBase64;
      } else {
        const templateBase64 = isUserDocx ? await readBase64(templateFile!) : undefined;
        const { data: res, error: err } = await supabase.functions.invoke('generate-invoice-adobe', {
          body: { data: adobeData, templateBase64 },
        });
        if (err) throw err;
        if (!res?.success || !res?.pdfBase64) throw new Error(res?.error || 'Adobe generation failed');
        pdfBase64 = res.pdfBase64;
      }

      updateItem(item.id, { progress: 90, message: 'Creating NOC…', generatedAt: Date.now() });

      // 8. Same NOC auto-create (one row per container in the BL)
      try {
        const { data: authData } = await supabase.auth.getUser();
        const uid = authData?.user?.id;
        if (uid && containers.length > 0) {
          const rows = containers.map((c) => ({
            user_id: uid,
            container_number: c,
            bl_number: blData?.bl_number || null,
            invoice_number: invNum,
            status: 'Pending Approval',
          }));
          await supabase.from('noc_records').insert(rows);
        }
      } catch (e) {
        console.error('NOC bulk insert failed:', e);
      }

      const done: BulkBlItem = {
        ...item,
        status: 'done',
        message: 'Generated',
        containerNumber,
        blNumber,
        invoiceNumber: invNum,
        companyPrice: matched.price,
        weight,
        blData,
        pdfBase64,
        progress: 100,
        nocAt: Date.now(),
      };
      updateItem(item.id, done);
      return done;
    } catch (err: any) {
      console.error('Bulk BL processing failed:', err);
      const failed: BulkBlItem = { ...item, status: 'failed', message: err?.message || 'Failed', progress: 100 };
      updateItem(item.id, failed);
      return failed;
    }
  };

  const processAll = async () => {
    if (items.length === 0) return;
    if (excelRows.length === 0) {
      toast.error('Please upload the Excel file first (Excel Auto-Fill section).');
      return;
    }
    setProcessing(true);
    try {
      // Run the exact single-BL workflow once per file, independently
      for (const item of items) {
        await processBL(item);
      }
      toast.success('Bulk processing finished.');
    } finally {
      setProcessing(false);
    }
  };

  const downloadPdf = (base64: string, filename: string) => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadOne = (item: BulkBlItem) => {
    if (!item.pdfBase64) return;
    // Same naming as single-BL (Invoice_<container>.pdf)
    const container = item.containerNumber
      ? sanitize(item.containerNumber)
      : new Date().toISOString().split('T')[0].replace(/-/g, '');
    downloadPdf(item.pdfBase64, `Invoice_${container}.pdf`);
  };

  const downloadAll = () => {
    const done = items.filter((i) => i.pdfBase64);
    if (done.length === 0) {
      toast.error('No generated invoices to download.');
      return;
    }
    done.forEach((it, idx) => {
      setTimeout(() => downloadOne(it), idx * 250);
    });
  };

  const statusBadge = (s: BulkStatus) => {
    const map: Record<BulkStatus, { label: string; cls: string; icon: any }> = {
      pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-600 border-amber-200', icon: Clock },
      processing: { label: 'Processing', cls: 'bg-indigo-50 text-indigo-600 border-indigo-200', icon: Loader2 },
      matched: { label: 'Matched', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200', icon: CheckCircle2 },
      no_match: { label: 'No Match', cls: 'bg-red-50 text-red-600 border-red-200', icon: XCircle },
      failed: { label: 'Failed', cls: 'bg-red-50 text-red-600 border-red-200', icon: XCircle },
      done: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200', icon: CheckCircle2 },
    };
    const v = map[s];
    const Icon = v.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${v.cls}`}>
        <Icon className={`w-3.5 h-3.5 ${s === 'processing' ? 'animate-spin' : ''}`} />
        {v.label}
      </span>
    );
  };

  const features = [
    { icon: Brain, label: 'AI Extraction', sub: 'Smart data extraction', color: 'bg-sky-100 text-sky-600' },
    { icon: Link2, label: 'Accurate Matching', sub: 'Excel auto matching', color: 'bg-emerald-100 text-emerald-600' },
    { icon: Calculator, label: 'Auto Calculations', sub: 'Weights, prices & amounts', color: 'bg-amber-100 text-amber-600' },
    { icon: FileCheck2, label: 'Invoice Generation', sub: 'PDF with template mapping', color: 'bg-violet-100 text-violet-600' },
  ];

  const progressFor = (s: BulkStatus) => {
    if (s === 'done' || s === 'matched') return 100;
    if (s === 'processing') return 60;
    if (s === 'failed' || s === 'no_match') return 100;
    return 0;
  };

  const progressColor = (s: BulkStatus) => {
    if (s === 'done' || s === 'matched') return 'bg-emerald-500';
    if (s === 'processing') return 'bg-gradient-to-r from-indigo-500 to-violet-500';
    if (s === 'failed' || s === 'no_match') return 'bg-red-400';
    return 'bg-slate-200';
  };

  const generatedCount = items.filter((i) => i.pdfBase64).length;

  const summary = useMemo(() => ({
    total: items.length,
    pending: items.filter((i) => i.status === 'pending').length,
    processing: items.filter((i) => i.status === 'processing').length,
    completed: items.filter((i) => i.status === 'done' || i.status === 'matched').length,
    failed: items.filter((i) => i.status === 'failed' || i.status === 'no_match').length,
  }), [items]);

  const viewFile = (item: BulkBlItem) => {
    const blob = item.pdfBase64
      ? (() => {
          const bin = atob(item.pdfBase64!);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new Blob([bytes], { type: 'application/pdf' });
        })()
      : item.file;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const hasItems = items.length > 0;

  return (
    <div className="rounded-3xl bg-white border border-slate-200 shadow-[0_8px_40px_-16px_rgba(99,102,241,0.25)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 sm:px-7 py-4 sm:py-5 border-b border-slate-100 bg-gradient-to-br from-indigo-50/60 via-white to-violet-50/40">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Layers3Icon />
          </div>
          <div>
            <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Multi-BL Processing</h3>
            <p className="text-xs sm:text-sm text-slate-500">Process up to {MAX_BULK_FILES} BL files</p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-indigo-100 text-xs sm:text-sm font-semibold text-indigo-600 shadow-sm">
          <FileText className="w-3.5 h-3.5" />
          {items.length} / {MAX_BULK_FILES}
        </div>
      </div>

      <div className="p-5 sm:p-7 space-y-6">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          multiple
          onChange={handlePick}
          className="hidden"
        />

        {/* Upload dropzone */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => !processing && inputRef.current?.click()}
          className="relative border-2 border-dashed border-indigo-200 rounded-2xl px-6 py-8 sm:py-10 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/40 transition-all bg-gradient-to-br from-indigo-50/40 to-white"
        >
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white border border-indigo-100 flex items-center justify-center shadow-sm"
          >
            <UploadCloud className="w-7 h-7 text-indigo-500" />
          </motion.div>
          <p className="text-base sm:text-lg font-bold text-slate-800">Upload up to {MAX_BULK_FILES} BL files</p>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">PDF, JPG, JPEG, PNG</p>
          <Button
            type="button"
            disabled={processing}
            className="mt-5 gap-2 px-6 py-2.5 h-auto bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-lg shadow-indigo-500/30"
          >
            <Upload className="w-4 h-4" />
            {hasItems ? 'Upload More' : 'Choose Files'}
          </Button>
          {hasItems && (
            <p className="mt-4 text-xs sm:text-sm text-slate-600">
              <span className="font-bold text-indigo-600">{items.length}</span> of{' '}
              <span className="font-bold text-violet-600">{MAX_BULK_FILES}</span> files uploaded
            </p>
          )}
        </motion.div>

        {/* Summary cards */}
        <AnimatePresence>
          {hasItems && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4"
            >
              <SummaryCard icon={FileText} label="Total Files" value={`${summary.total} / ${MAX_BULK_FILES}`} sub="Uploaded" tone="indigo" />
              <SummaryCard icon={Clock} label="Pending" value={summary.pending + summary.processing} sub="Processing" tone="amber" />
              <SummaryCard icon={CheckCircle2} label="Completed" value={summary.completed} sub="Completed" tone="emerald" />
              <SummaryCard icon={XCircle} label="Failed" value={summary.failed} sub="Failed" tone="red" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action buttons */}
        {hasItems && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={clearAll}
                disabled={processing}
                className="h-12 rounded-xl border-red-200 bg-red-50/40 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 gap-2 font-semibold"
              >
                <Trash2 className="w-4 h-4" />
                Clear All
              </Button>
              <Button
                variant="outline"
                onClick={downloadAll}
                disabled={generatedCount === 0}
                className="h-12 rounded-xl border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300 gap-2 font-semibold"
              >
                <BarChart3 className="w-4 h-4" />
                View Report
              </Button>
            </div>
            <Button
              onClick={processAll}
              disabled={processing}
              className="w-full h-14 rounded-xl gap-2 text-base font-semibold bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:via-violet-700 hover:to-purple-700 shadow-lg shadow-indigo-500/30"
            >
              {processing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  Process All Files
                </>
              )}
            </Button>
          </motion.div>
        )}

        {/* Feature chips (only when empty) */}
        {!hasItems && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {features.map((f) => (
              <motion.div
                key={f.label}
                whileHover={{ y: -2 }}
                className="flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-100 shadow-sm"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${f.color}`}>
                  <f.icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{f.label}</p>
                  <p className="text-xs text-slate-400 truncate">{f.sub}</p>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* File list */}
        {hasItems && (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            {/* Desktop header */}
            <div className="hidden md:grid grid-cols-[60px_1fr_160px_1fr_140px] gap-4 px-5 py-3 bg-slate-50/80 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <span>#</span>
              <span>File Name</span>
              <span>Status</span>
              <span>Progress</span>
              <span className="text-right">Action</span>
            </div>

            <AnimatePresence initial={false}>
              {items.map((it, idx) => {
                const pct = progressFor(it.status);
                const canDownload = !!it.pdfBase64;
                return (
                  <motion.div
                    key={it.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                    className={`border-b last:border-b-0 border-slate-100 ${
                      it.status === 'processing' ? 'bg-indigo-50/30' : 'hover:bg-slate-50/60'
                    } transition-colors`}
                  >
                    {/* Desktop row */}
                    <div className="hidden md:grid grid-cols-[60px_1fr_160px_1fr_140px] gap-4 items-center px-5 py-4">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm font-bold">
                        {idx + 1}
                      </div>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                          <FileIcon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          {it.invoiceNumber && (
                            <p className="text-xs text-slate-400">{it.invoiceNumber}</p>
                          )}
                          <p className="text-sm font-semibold text-slate-800 truncate" title={it.file.name}>
                            {it.file.name}
                          </p>
                          <p className="text-xs text-slate-400">{formatBytes(it.file.size)}</p>
                        </div>
                      </div>
                      <div>{statusBadge(it.status)}</div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5 }}
                            className={`h-full rounded-full ${progressColor(it.status)}`}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-500 w-10 text-right">{pct}%</span>
                      </div>
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => viewFile(it)}
                          className="w-9 h-9 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 flex items-center justify-center transition-colors"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => canDownload && downloadOne(it)}
                          disabled={!canDownload}
                          className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors ${
                            canDownload
                              ? 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                              : 'border-slate-200 text-slate-300 cursor-not-allowed'
                          }`}
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Mobile row */}
                    <div className="md:hidden p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">
                          {idx + 1}
                        </div>
                        <div className="w-10 h-10 rounded-lg bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                          <FileIcon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          {it.invoiceNumber && (
                            <p className="text-xs text-slate-400">{it.invoiceNumber}</p>
                          )}
                          <p className="text-sm font-semibold text-slate-800 truncate">{it.file.name}</p>
                          <p className="text-xs text-slate-400">{formatBytes(it.file.size)}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        {statusBadge(it.status)}
                        <span className="text-xs font-semibold text-slate-500">{pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.5 }}
                          className={`h-full rounded-full ${progressColor(it.status)}`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => viewFile(it)}
                          className="flex-1 h-10 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                        >
                          <Eye className="w-4 h-4" /> View
                        </button>
                        <button
                          onClick={() => canDownload && downloadOne(it)}
                          disabled={!canDownload}
                          className={`flex-1 h-10 rounded-lg border flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
                            canDownload
                              ? 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                              : 'border-slate-200 text-slate-300 cursor-not-allowed'
                          }`}
                        >
                          <Download className="w-4 h-4" /> Download
                        </button>
                      </div>
                      {it.message && (
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          {it.status === 'failed' || it.status === 'no_match' ? (
                            <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                          ) : null}
                          {it.message}
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

function Layers3Icon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 12 10 5 10-5" />
      <path d="m2 17 10 5 10-5" />
    </svg>
  );
}

function SummaryCard({
  icon: Icon, label, value, sub, tone,
}: {
  icon: any; label: string; value: number | string; sub: string;
  tone: 'indigo' | 'amber' | 'emerald' | 'red';
}) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-500',
  };
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${tones[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-xs sm:text-sm text-slate-500 font-medium">{label}</p>
      <p className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1 leading-tight">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </motion.div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
