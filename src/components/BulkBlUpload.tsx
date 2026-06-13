import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Upload, Loader2, CheckCircle2, X, Download, AlertCircle, UploadCloud,
  FileText, Brain, Link2, Calculator, FileCheck2, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
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
    setItems(
      files.map((f, i) => ({
        id: `${Date.now()}-${i}`,
        file: f,
        status: 'pending' as BulkStatus,
      })),
    );
  };

  const clearAll = () => setItems([]);

  const updateItem = (id: string, patch: Partial<BulkBlItem>) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const processBL = async (item: BulkBlItem): Promise<BulkBlItem> => {
    try {
      updateItem(item.id, { status: 'processing', message: 'Extracting…' });

      // 1. AI Extraction (same edge function as single BL)
      const base64 = await readBase64(item.file);
      const { data: rawData, error } = await supabase.functions.invoke('extract-bl-data', {
        body: { fileBase64: base64, mimeType: item.file.type },
      });
      if (error) throw error;

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
        message: 'Generating PDF…',
        containerNumber,
        blNumber,
        invoiceNumber: invNum,
        companyPrice: matched.price,
        weight,
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
      };
      updateItem(item.id, done);
      return done;
    } catch (err: any) {
      console.error('Bulk BL processing failed:', err);
      const failed: BulkBlItem = { ...item, status: 'failed', message: err?.message || 'Failed' };
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
    const map: Record<BulkStatus, { label: string; cls: string }> = {
      pending: { label: 'Pending', cls: 'bg-muted text-muted-foreground' },
      processing: { label: 'Processing…', cls: 'bg-primary/10 text-primary' },
      matched: { label: 'Matched', cls: 'bg-emerald-500/10 text-emerald-600' },
      no_match: { label: '✗ No Match', cls: 'bg-destructive/10 text-destructive' },
      failed: { label: '✗ Failed', cls: 'bg-destructive/10 text-destructive' },
      done: { label: '✓ Done', cls: 'bg-emerald-500/10 text-emerald-600' },
    };
    const v = map[s];
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${v.cls}`}>{v.label}</span>;
  };

  const generatedCount = items.filter((i) => i.pdfBase64).length;

  const features = [
    { icon: Brain, label: 'AI Extraction', sub: 'Smart data extraction', color: 'bg-sky-100 text-sky-600' },
    { icon: Link2, label: 'Accurate Matching', sub: 'Excel auto matching', color: 'bg-emerald-100 text-emerald-600' },
    { icon: Calculator, label: 'Auto Calculations', sub: 'Weights, prices & amounts', color: 'bg-amber-100 text-amber-600' },
    { icon: FileCheck2, label: 'Invoice Generation', sub: 'PDF with template mapping', color: 'bg-violet-100 text-violet-600' },
  ];

  return (
    <div className="rounded-2xl bg-white border border-blue-100 shadow-[0_4px_24px_-12px_rgba(59,130,246,0.25)] overflow-hidden">
      <div className="p-5 sm:p-6 bg-gradient-to-br from-blue-50/80 to-transparent">
        <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shadow-sm">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-blue-700">Bulk BL Upload (Max 10 Files)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Each BL runs the exact same Single-BL workflow (AI extraction → Excel match → calculations → template → PDF → NOC).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100">
            {items.length} / {MAX_BULK_FILES} Files
            <Info className="w-3.5 h-3.5 opacity-70" />
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          multiple
          onChange={handlePick}
          className="hidden"
        />

        <div
          onClick={() => !processing && inputRef.current?.click()}
          className="border-2 border-dashed border-blue-200 rounded-2xl p-8 sm:p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition-all bg-white/60"
        >
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white border border-blue-200 flex items-center justify-center shadow-sm">
            <UploadCloud className="w-6 h-6 text-blue-500" />
          </div>
          <p className="text-base font-semibold text-slate-700">Click to upload up to 10 BL files</p>
          <p className="text-xs text-slate-400 mt-1">PDF, JPG, JPEG, PNG</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
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

        {items.length > 0 && (
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm text-slate-500">{items.length} file(s) ready</p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={clearAll} disabled={processing}>
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
                <Button onClick={processAll} disabled={processing} className="gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
                  {processing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing…
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Process All
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Container</TableHead>
                    <TableHead>BL #</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Company Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <AnimatePresence>
                    {items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="font-medium max-w-[180px] truncate" title={it.file.name}>
                          {it.file.name}
                        </TableCell>
                        <TableCell>{it.containerNumber || '—'}</TableCell>
                        <TableCell>{it.blNumber || '—'}</TableCell>
                        <TableCell>{it.invoiceNumber || '—'}</TableCell>
                        <TableCell>{it.companyPrice || '—'}</TableCell>
                        <TableCell>{statusBadge(it.status)}</TableCell>
                        <TableCell className="text-right">
                          {it.pdfBase64 ? (
                            <Button size="sm" variant="outline" onClick={() => downloadOne(it)} className="gap-1">
                              <Download className="w-3.5 h-3.5" />
                              PDF
                            </Button>
                          ) : it.message ? (
                            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                              {it.status === 'failed' || it.status === 'no_match' ? (
                                <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                              ) : it.status === 'processing' ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              )}
                              {it.message}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </AnimatePresence>
                </TableBody>
              </Table>
            </div>

            {generatedCount > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Button onClick={downloadAll} className="w-full gap-2" variant="default">
                  <Download className="w-4 h-4" />
                  Download All ({generatedCount})
                </Button>
              </motion.div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
