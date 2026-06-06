import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Loader2, CheckCircle2, X, Download, Package, AlertCircle, FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const MAX_BULK_FILES = 5;
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

const cleanContainerNumber = (raw: string): string => {
  if (!raw) return '';
  const compact = raw.toString().toUpperCase().replace(/[\s\-_./\\]/g, '');
  const m = compact.match(/([A-Z]{4}\d{7})/);
  return m ? m[1] : '';
};

const cleanContainerList = (arr: any): string[] => {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const v of arr) {
    const c = cleanContainerNumber(String(v ?? ''));
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
};

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const todayDDMMYY = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '');

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

  const clearAll = () => {
    setItems([]);
  };

  const updateItem = (id: string, patch: Partial<BulkBlItem>) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const computeCalc = (companyPriceStr: string, weight: number) => {
    const companyPriceNum = Number(String(companyPriceStr).replace(/,/g, ''));
    if (!isFinite(companyPriceNum) || !isFinite(weight) || weight === 0) return null;
    const raw = companyPriceNum / weight;
    const truncated = Math.floor(raw * 100) / 100;
    const unitPrice = truncated < 0.42 ? 0.42 : truncated;
    const unitPriceText = unitPrice.toFixed(2);
    const totalRaw = Math.floor(unitPrice * weight * 1000) / 1000;
    const totalText = totalRaw.toFixed(3);
    return { unitPrice, unitPriceText, totalText, totalDisplay: totalText };
  };

  const processBL = async (item: BulkBlItem): Promise<BulkBlItem> => {
    try {
      updateItem(item.id, { status: 'processing', message: 'Extracting…' });
      const base64 = await readBase64(item.file);
      const { data, error } = await supabase.functions.invoke('extract-bl-data', {
        body: { fileBase64: base64, mimeType: item.file.type },
      });
      if (error) throw error;

      // Clean container numbers to strict ISO format (4 letters + 7 digits)
      const cleanedContainers = cleanContainerList(data?.container_numbers);
      if (data) data.container_numbers = cleanedContainers;

      const containerNumber = cleanedContainers[0] || '';
      const blNumber = (data?.bl_number || '').trim();
      const weight = Number(data?.kgs);

      const matchKey = normalizeKey(containerNumber);
      const matched = containerNumber ? excelRows.find((r) => normalizeKey(cleanContainerNumber(r.container) || r.container) === matchKey) : undefined;

      if (!matched) {
        const failed: BulkBlItem = {
          ...item,
          status: 'no_match',
          message: 'No Excel match',
          containerNumber,
          blNumber,
          blData: data,
          weight: isFinite(weight) ? weight : undefined,
        };
        updateItem(item.id, failed);
        return failed;
      }

      const calc = isFinite(weight) ? computeCalc(matched.price, weight) : null;
      if (!calc) {
        const failed: BulkBlItem = {
          ...item,
          status: 'failed',
          message: 'Missing weight/price',
          containerNumber,
          blNumber,
          invoiceNumber: matched.invoice,
          companyPrice: matched.price,
          blData: data,
        };
        updateItem(item.id, failed);
        return failed;
      }

      const invNum = matched.invoice || blNumber || `INV-${Date.now()}`;
      const containerNums = (data?.container_numbers || []).join(', ');
      const firstContainer = containerNumber;
      const containerSize = data?.container_size || '';
      const bales = data?.bales || '';

      const adobeData = {
        invoice_number: invNum,
        date: todayDDMMYY(),
        shipper: data?.shipper || '',
        shipper_address: data?.shipper_address || '',
        consignee: data?.consignee || '',
        consignee_address: data?.consignee_address || '',
        notify_party: data?.notify_party || data?.consignee || '',
        notify_party_address: data?.notify_party_address || data?.consignee_address || '',
        container_size: containerSize,
        container_numbers: containerNums,
        container_numbers_one: firstContainer,
        vessel: data?.vessel_name || '',
        port_of_loading: data?.port_of_loading || '',
        port_of_discharge: data?.port_of_discharge || '',
        hs_code: data?.hs_code || '',
        goods_description: data?.description || '',
        gross_weight: `${weight}KGS`,
        unit_price: `${calc.unitPriceText}US$ Per KG`,
        amount: `${calc.totalText}$`,
        shipping_marks: data?.shipping_marks || 'NIL',
        packages: bales ? `${bales} BALES` : (data?.packages || ''),
        company_name: data?.shipper || '',
      };

      updateItem(item.id, { status: 'processing', message: 'Generating PDF…', containerNumber, blNumber, invoiceNumber: invNum, companyPrice: matched.price, weight });

      const tplName = (templateFile?.name || '').toLowerCase();
      const isUserPdf = templateFile && (templateFile.type === 'application/pdf' || tplName.endsWith('.pdf'));
      const isUserDocx = templateFile && (
        tplName.endsWith('.docx') || tplName.endsWith('.doc') ||
        templateFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      let pdfBase64: string | undefined;
      if (isUserPdf) {
        const overlayData = {
          ...adobeData,
          shipper: [data?.shipper, data?.shipper_address].filter(Boolean).join('\n'),
          consignee: [data?.consignee, data?.consignee_address].filter(Boolean).join('\n'),
          notify_party: [
            data?.notify_party || data?.consignee,
            data?.notify_party_address || data?.consignee_address,
          ].filter(Boolean).join('\n'),
        };
        const templateBase64 = await readBase64(templateFile!);
        const { data: res, error: err } = await supabase.functions.invoke('generate-invoice-overlay', {
          body: { templateBase64, data: overlayData, fields: templateLayout?.fields ?? [] },
        });
        if (err) throw err;
        if (!res?.success) throw new Error(res?.error || 'overlay failed');
        pdfBase64 = res.pdfBase64;
      } else {
        const templateBase64 = isUserDocx ? await readBase64(templateFile!) : undefined;
        const { data: res, error: err } = await supabase.functions.invoke('generate-invoice-adobe', {
          body: { data: adobeData, templateBase64 },
        });
        if (err) throw err;
        if (!res?.success || !res?.pdfBase64) throw new Error(res?.error || 'adobe failed');
        pdfBase64 = res.pdfBase64;
      }

      // NOC tracking
      try {
        const { data: authData } = await supabase.auth.getUser();
        const uid = authData?.user?.id;
        const containers = (data?.container_numbers || []).filter(Boolean);
        if (uid && containers.length > 0) {
          const rows = containers.map((c: string) => ({
            user_id: uid,
            container_number: c,
            bl_number: data?.bl_number || null,
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
        blData: data,
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

  return (
    <Card className="border-border/50 shadow-sm overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-indigo-500/5 to-transparent">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Package className="w-5 h-5 text-indigo-600" />
          Bulk BL Upload (Max 5 Files)
        </CardTitle>
        <CardDescription>
          Process up to 5 BL files at once. Each BL is treated independently and matched against the uploaded Excel.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
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
          className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all"
        >
          <FileUp className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
          <p className="font-medium text-foreground">Click to upload up to 5 BL files</p>
          <p className="text-xs text-muted-foreground mt-1">PDF, JPG, JPEG, PNG</p>
        </div>

        {items.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{items.length} file(s) ready</p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={clearAll} disabled={processing}>
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
                <Button onClick={processAll} disabled={processing} className="gap-2">
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

            <div className="rounded-xl border border-border overflow-x-auto">
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
                <Button onClick={downloadAll} className="w-full gap-2" variant="secondary">
                  <Download className="w-4 h-4" />
                  Download All Invoices ({generatedCount})
                </Button>
              </motion.div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
