import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  FileText, Upload, Calculator, Download, Loader2, CheckCircle2,
  AlertCircle, Scale, DollarSign, Hash, ArrowRight,
  Sparkles, Ship, FileUp, Eye, Package, RotateCcw
} from 'lucide-react';

interface BLData {
  kgs: number | null;
  shipper: string | null;
  shipper_address: string | null;
  consignee: string | null;
  consignee_address: string | null;
  notify_party: string | null;
  notify_party_address: string | null;
  port_of_loading: string | null;
  port_of_discharge: string | null;
  description: string | null;
  packages: string | null;
  bales: number | null;
  container_numbers: string[];
  container_size: string | null;
  bl_number: string | null;
  vessel_name: string | null;
  hs_code: string | null;
  shipping_marks: string | null;
  bl_date: string | null;
  raw_weight_text: string | null;
}

GlobalWorkerOptions.workerSrc = pdfWorker;

const DEFAULT_PAGE_WIDTH = 1240;
const DEFAULT_PAGE_HEIGHT = 1754;
const PDF_TEMPLATE_SCALE = 2.4;
const PDF_FONT_FAMILY = 'Arial, Helvetica, sans-serif';

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const readFileAsBase64 = async (file: File) => {
  const dataUrl = await readFileAsDataUrl(file);
  return dataUrl.split(',')[1];
};

const escapeHtml = (value: string | number | null | undefined) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const formatMultiline = (value: string | number | null | undefined) => escapeHtml(value).replace(/\n/g, '<br />');

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = src;
});

const getTemplateBackground = async (file: File | null) => {
  if (!file) return null;

  if (file.type === 'application/pdf') {
    const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: PDF_TEMPLATE_SCALE });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Template render context not available');
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({ canvas, canvasContext: context, viewport }).promise;
    pdf.destroy();

    return {
      src: canvas.toDataURL('image/png', 1),
      width: canvas.width,
      height: canvas.height,
    };
  }

  const src = await readFileAsDataUrl(file);
  const image = await loadImage(src);

  return {
    src,
    width: image.naturalWidth || DEFAULT_PAGE_WIDTH,
    height: image.naturalHeight || DEFAULT_PAGE_HEIGHT,
  };
};

export default function InvoiceGenerator() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const blInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);

  const [blFile, setBlFile] = useState<File | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [companyPrice, setCompanyPrice] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [balesCount, setBalesCount] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  });
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [blData, setBlData] = useState<BLData | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [templateLayout, setTemplateLayout] = useState<any>(null);
  const [extractingTemplate, setExtractingTemplate] = useState(false);

  if (authLoading) return <div className="min-h-screen bg-background" />;
  if (!user) {
    navigate('/auth');
    return <div className="min-h-screen bg-background" />;
  }

  const handleBLUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const valid = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!valid.includes(file.type)) {
      toast.error('Please upload a PDF or Image file');
      return;
    }
    setBlFile(file);
    setBlData(null);
  };

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTemplateFile(file);
    
    // Extract template layout using AI
    setExtractingTemplate(true);
    try {
      const base64 = await readFileAsBase64(file);

      const { data, error } = await supabase.functions.invoke('extract-template-layout', {
        body: { fileBase64: base64, mimeType: file.type },
      });

      if (error) throw error;
      setTemplateLayout(data);
      toast.success('Template ready! Invoice will keep the same background, logo, stamp, and spacing.');
    } catch (err: any) {
      console.error('Template extraction error:', err);
      toast.warning('Template uploaded. Original template background will still be used for exact visual matching.');
      setTemplateLayout(null);
    } finally {
      setExtractingTemplate(false);
    }
  };

  const extractBLData = async () => {
    if (!blFile) return;
    setExtracting(true);
    try {
      const base64 = await readFileAsBase64(blFile);

      const { data, error } = await supabase.functions.invoke('extract-bl-data', {
        body: { fileBase64: base64, mimeType: blFile.type },
      });

      if (error) throw error;

      if (data.kgs) {
        setBlData(data);
        if (data.bales) setBalesCount(String(data.bales));
        if (data.bl_number) setInvoiceNumber(data.bl_number);
        if (data.bl_date) setInvoiceDate(data.bl_date);
        setStep(2);
        toast.success(`KGS extracted: ${data.kgs} kg`);
      } else {
        setBlData(data);
        toast.error('Could not extract weight (KGS) from the BL. Please check the file.');
      }
    } catch (err: any) {
      console.error('BL extraction error:', err);
      toast.error('Failed to extract BL data: ' + (err.message || 'Unknown error'));
    } finally {
      setExtracting(false);
    }
  };

  const calculateValues = () => {
    if (!blData?.kgs || !companyPrice) return null;
    const price = parseFloat(companyPrice);
    if (isNaN(price)) return null;
    let unitPrice = Math.round((price / blData.kgs) * 100) / 100;
    if (unitPrice < 0.42) unitPrice = 0.42;
    const totalPrice = Math.round(unitPrice * blData.kgs * 100) / 100;
    return { unitPrice, totalPrice, kgs: blData.kgs };
  };

  const generateInvoicePDF = async (calc: { unitPrice: number; totalPrice: number; kgs: number }) => {
    const invNum = invoiceNumber || `INV-${Date.now()}`;
    const bales = balesCount || blData?.bales || '';
    const date = invoiceDate;
    const containerNums = blData?.container_numbers?.join(', ') || '';
    const containerSize = blData?.container_size || '';
    const templateBackground = await getTemplateBackground(templateFile);
    const pageWidth = templateBackground?.width || DEFAULT_PAGE_WIDTH;
    const pageHeight = templateBackground?.height || DEFAULT_PAGE_HEIGHT;
    const bodyFont = Math.max(18, Math.round(pageWidth * 0.0142));
    const compactFont = Math.max(17, Math.round(pageWidth * 0.0134));
    const largeFont = Math.max(20, Math.round(pageWidth * 0.0155));
    const amountFont = Math.max(21, Math.round(pageWidth * 0.0164));
    const shipperBlock = [blData?.shipper, blData?.shipper_address].filter(Boolean).join('\n');
    const consigneeBlock = [blData?.consignee, blData?.consignee_address].filter(Boolean).join('\n');
    const notifyBlock = [blData?.consignee || blData?.notify_party, blData?.consignee_address || blData?.notify_party_address].filter(Boolean).join('\n');

    const createDefaultMarkup = () => `
      <div style="display:flex;flex-direction:column;width:100%;height:100%;padding:40px 50px 40px 50px;box-sizing:border-box;font-family:${PDF_FONT_FAMILY};font-weight:700;color:#000;">
        <div style="display:flex;width:100%;">
          <div style="flex:1;padding-right:20px;">
            <div style="font-size:11px;margin-bottom:4px;font-weight:700;">1.Shipper</div>
            <div style="font-size:12px;font-weight:700;">${escapeHtml(blData?.shipper || '')}</div>
            <div style="font-size:11px;line-height:1.5;margin-top:2px;font-weight:700;">${formatMultiline(blData?.shipper_address || '')}</div>
          </div>
          <div style="flex:1;padding-left:20px;">
            <div style="font-size:20px;text-align:center;margin-bottom:12px;letter-spacing:1px;font-weight:700;">INVOICE/PACKING</div>
            <div style="display:flex;gap:30px;margin-bottom:4px;">
              <div style="font-size:10px;font-weight:700;">Invoice No.</div>
              <div style="font-size:10px;font-weight:700;">Date</div>
            </div>
            <div style="display:flex;gap:30px;margin-bottom:14px;">
              <div style="font-size:12px;font-weight:700;">${escapeHtml(invNum)}</div>
              <div style="font-size:12px;font-weight:700;">${escapeHtml(date)}</div>
            </div>
            <div style="font-size:10px;margin-bottom:4px;font-weight:700;">NOTIFY PARTY</div>
            <div style="font-size:12px;font-weight:700;">${escapeHtml(blData?.consignee || '')}</div>
            <div style="font-size:11px;line-height:1.5;margin-top:2px;font-weight:700;">${formatMultiline(blData?.consignee_address || '')}</div>
          </div>
        </div>
        <div style="display:flex;width:100%;margin-top:20px;">
          <div style="flex:1;padding-right:20px;">
            <div style="font-size:11px;margin-bottom:4px;font-weight:700;">2.Consignee</div>
            <div style="font-size:12px;font-weight:700;">${escapeHtml(blData?.consignee || '')}</div>
            <div style="font-size:11px;line-height:1.5;margin-top:2px;font-weight:700;">${formatMultiline(blData?.consignee_address || '')}</div>
          </div>
          <div style="flex:1;padding-left:20px;">
            <div style="font-size:12px;margin-bottom:4px;font-weight:700;">${escapeHtml(containerSize)}</div>
            <div style="font-size:10px;font-weight:700;">CONTAINER NO:</div>
            <div style="font-size:12px;margin-top:4px;font-weight:700;">${escapeHtml(containerNums)}</div>
          </div>
        </div>
        <div style="display:flex;width:100%;margin-top:20px;">
          <div style="flex:1;padding-right:20px;">
            <div style="font-size:10px;margin-bottom:4px;font-weight:700;">VESSEL / FLIGHT</div>
            <div style="font-size:12px;font-weight:700;">${escapeHtml(blData?.vessel_name || '')}</div>
          </div>
          <div style="flex:1;padding-left:20px;">
            <div style="font-size:10px;font-weight:700;">HS CODE: ${escapeHtml(blData?.hs_code || '')}</div>
          </div>
        </div>
        <div style="display:flex;width:100%;margin-top:16px;">
          <div style="flex:1;padding-right:20px;">
            <div style="font-size:10px;margin-bottom:4px;font-weight:700;">Port of Loading</div>
            <div style="font-size:12px;font-weight:700;">${escapeHtml(blData?.port_of_loading || '')}</div>
            <div style="font-size:10px;margin-top:10px;font-weight:700;">${escapeHtml(blData?.port_of_discharge || '')}</div>
          </div>
          <div style="flex:1;padding-left:20px;">
            <div style="font-size:10px;margin-bottom:4px;font-weight:700;">Goods Description</div>
            <div style="font-size:12px;font-weight:700;">${escapeHtml(blData?.description || '')}</div>
          </div>
        </div>
        <div style="display:flex;width:100%;margin-top:20px;">
          <div style="flex:1;padding-right:20px;">
            <div style="font-size:10px;margin-bottom:6px;font-weight:700;">No.& Kind of Pkgs</div>
            <div style="font-size:12px;text-align:center;font-weight:700;">${escapeHtml(String(bales))}${bales ? ' BALES' : ''}</div>
          </div>
          <div style="flex:1;padding-left:20px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:10px;font-weight:700;">G.Weight</span>
              <span style="font-size:11px;font-weight:700;">${escapeHtml(calc.kgs.toFixed(4))} KGS</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:10px;font-weight:700;">Unit Price</span>
              <span style="font-size:11px;font-weight:700;">${escapeHtml(calc.unitPrice.toFixed(2))} US$ Per KG</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="font-size:10px;font-weight:700;">Amount</span>
              <span style="font-size:11px;font-weight:700;">${escapeHtml(calc.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} US$</span>
            </div>
          </div>
        </div>
        <div style="margin-top:auto;text-align:center;padding-top:40px;">
          <div style="font-size:13px;font-weight:700;">${escapeHtml(blData?.shipper || 'COMPANY NAME')}</div>
        </div>
      </div>
    `;

    const createTemplateMarkup = () => `
      <div style="position:relative;width:100%;height:100%;background:#fff;font-family:${PDF_FONT_FAMILY};overflow:hidden;">
        <img src="${templateBackground?.src}" alt="Invoice Template" style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill;display:block;" />
        <div style="position:absolute;inset:0;color:#000;font-family:${PDF_FONT_FAMILY};font-weight:700;">
          <div style="position:absolute;left:6.8%;top:12.2%;width:38.5%;font-size:${compactFont}px;line-height:1.36;word-break:break-word;">${formatMultiline(shipperBlock)}</div>
          <div style="position:absolute;left:68.2%;top:10.35%;width:11.2%;font-size:${bodyFont}px;line-height:1.2;">${escapeHtml(invNum)}</div>
          <div style="position:absolute;left:81.9%;top:10.35%;width:11.4%;font-size:${bodyFont}px;line-height:1.2;">${escapeHtml(date)}</div>
          <div style="position:absolute;left:56.3%;top:18.4%;width:36.2%;font-size:${compactFont}px;line-height:1.36;word-break:break-word;">${formatMultiline(notifyBlock)}</div>
          <div style="position:absolute;left:6.8%;top:36.8%;width:38.5%;font-size:${compactFont}px;line-height:1.36;word-break:break-word;">${formatMultiline(consigneeBlock)}</div>
          <div style="position:absolute;left:56.3%;top:39.2%;width:36.2%;font-size:${bodyFont}px;line-height:1.25;word-break:break-word;">${escapeHtml(containerSize)}</div>
          <div style="position:absolute;left:56.3%;top:43.15%;width:36.8%;font-size:${bodyFont}px;line-height:1.3;word-break:break-word;">${escapeHtml(containerNums)}</div>
          <div style="position:absolute;left:6.8%;top:53.55%;width:38.5%;font-size:${bodyFont}px;line-height:1.28;word-break:break-word;">${escapeHtml(blData?.vessel_name || '')}</div>
          <div style="position:absolute;left:74.6%;top:53.55%;width:16.8%;font-size:${bodyFont}px;line-height:1.2;word-break:break-word;">${escapeHtml(blData?.hs_code || '')}</div>
          <div style="position:absolute;left:6.8%;top:62.0%;width:37.2%;font-size:${bodyFont}px;line-height:1.3;word-break:break-word;">${escapeHtml(blData?.port_of_loading || '')}</div>
          <div style="position:absolute;left:6.8%;top:68.0%;width:37.2%;font-size:${bodyFont}px;line-height:1.3;word-break:break-word;">${escapeHtml(blData?.port_of_discharge || '')}</div>
          <div style="position:absolute;left:56.3%;top:61.9%;width:36.6%;font-size:${compactFont}px;line-height:1.34;word-break:break-word;">${formatMultiline(blData?.description || '')}</div>
          <div style="position:absolute;left:17.4%;top:79.15%;width:23.2%;font-size:${largeFont}px;line-height:1.15;text-align:center;">${escapeHtml(String(bales))}${bales ? ' BALES' : ''}</div>
          <div style="position:absolute;left:69.8%;top:78.95%;width:21.2%;font-size:${bodyFont}px;line-height:1.15;text-align:right;">${escapeHtml(calc.kgs.toFixed(4))} KGS</div>
          <div style="position:absolute;left:64.8%;top:82.35%;width:26.2%;font-size:${bodyFont}px;line-height:1.15;text-align:right;">${escapeHtml(calc.unitPrice.toFixed(2))} US$ PER KG</div>
          <div style="position:absolute;left:66.2%;top:85.75%;width:24.8%;font-size:${amountFont}px;line-height:1.1;text-align:right;">${escapeHtml(calc.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} US$</div>
        </div>
      </div>
    `;

    const container = document.createElement('div');
    container.style.cssText = `position:fixed;left:-9999px;top:0;width:${pageWidth}px;height:${pageHeight}px;background:white;font-family:${PDF_FONT_FAMILY};color:#000;padding:0;margin:0;overflow:hidden;`;
    container.innerHTML = templateBackground ? createTemplateMarkup() : createDefaultMarkup();

    document.body.appendChild(container);

    try {
      const canvas = await html2canvas(container, {
        scale: templateBackground ? 2 : 3,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: pageWidth,
        height: pageHeight,
      });

      const imgData = canvas.toDataURL(templateBackground ? 'image/png' : 'image/jpeg', templateBackground ? 1 : 0.97);
      const doc = new jsPDF({
        orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
        unit: 'px',
        format: [pageWidth, pageHeight],
        compress: true,
      });
      doc.addImage(imgData, templateBackground ? 'PNG' : 'JPEG', 0, 0, pageWidth, pageHeight);
      return doc;
    } finally {
      document.body.removeChild(container);
    }
  };

  const generateInvoice = async () => {
    const calc = calculateValues();
    if (!calc) {
      toast.error('Please fill all required fields');
      return;
    }
    setGenerating(true);
    try {
      const invNum = invoiceNumber || `INV-${Date.now()}`;
      const doc = await generateInvoicePDF(calc);
      doc.save(`Invoice-${invNum}.pdf`);
      setStep(3);
      toast.success('Invoice generated and downloaded!');
    } catch (err: any) {
      console.error('Invoice generation error:', err);
      toast.error('Failed to generate invoice');
    } finally {
      setGenerating(false);
    }
  };

  const calc = calculateValues();

  const resetAll = () => {
    setBlFile(null);
    setTemplateFile(null);
    setCompanyPrice('');
    setInvoiceNumber('');
    setBalesCount('');
    setBlData(null);
    setStep(1);
    setTemplateLayout(null);
    setInvoiceDate(() => {
      const d = new Date();
      return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Page title */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Sparkles className="w-4 h-4" />
            AI-Powered Invoice Generator
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
            Generate Invoice from <span className="text-primary">Bill of Lading</span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Upload your BL, extract data automatically, and generate invoices matching your exact template.
          </p>
        </motion.div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {[
            { num: 1, label: 'Upload BL' },
            { num: 2, label: 'Enter Details' },
            { num: 3, label: 'Invoice Ready' },
          ].map((s, i) => (
            <div key={s.num} className="flex items-center gap-2">
              <motion.div
                animate={{
                  scale: step >= s.num ? 1 : 0.9,
                  backgroundColor: step >= s.num ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ color: step >= s.num ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))' }}
              >
                {step > s.num ? <CheckCircle2 className="w-4 h-4" /> : s.num}
              </motion.div>
              <span className={`text-sm font-medium hidden sm:inline ${step >= s.num ? 'text-foreground' : 'text-muted-foreground'}`}>
                {s.label}
              </span>
              {i < 2 && <ArrowRight className="w-4 h-4 text-muted-foreground mx-1" />}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Step 1: Upload BL */}
          <motion.div layout className="lg:col-span-2">
            <Card className="border-border/50 shadow-sm overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-primary" />
                  Step 1: Upload Bill of Lading
                </CardTitle>
                <CardDescription>Upload PDF or Image file of your BL document</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <input ref={blInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleBLUpload} className="hidden" />
                <div
                  onClick={() => blInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all duration-200"
                >
                  {blFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-500" />
                      <div className="text-left">
                        <p className="font-medium text-foreground">{blFile.name}</p>
                        <p className="text-xs text-muted-foreground">{(blFile.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="font-medium text-foreground">Click to upload BL file</p>
                      <p className="text-xs text-muted-foreground mt-1">PDF, PNG, JPG, WEBP</p>
                    </>
                  )}
                </div>

                <Button
                  onClick={extractBLData}
                  disabled={!blFile || extracting}
                  className="w-full gap-2"
                >
                  {extracting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Extracting data with AI...
                    </>
                  ) : (
                    <>
                      <Scale className="w-4 h-4" />
                      Extract BL Data
                    </>
                  )}
                </Button>

                {/* Extracted BL Data Preview */}
                <AnimatePresence>
                  {blData && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className={`rounded-xl p-4 border ${blData.kgs ? 'bg-green-500/5 border-green-500/20' : 'bg-destructive/5 border-destructive/20'}`}>
                        <div className="flex items-center gap-2 mb-3">
                          {blData.kgs ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-destructive" />
                          )}
                          <span className="font-semibold text-foreground">
                            {blData.kgs ? `Weight: ${blData.kgs} KGS` : 'Weight not detected'}
                          </span>
                          {blData.bales && (
                            <span className="text-sm text-muted-foreground ml-2">| {blData.bales} Bales</span>
                          )}
                        </div>
                        {blData.kgs && (
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            {blData.shipper && (
                              <div><span className="text-muted-foreground">Shipper:</span> <span className="text-foreground">{blData.shipper}</span></div>
                            )}
                            {blData.consignee && (
                              <div><span className="text-muted-foreground">Consignee:</span> <span className="text-foreground">{blData.consignee}</span></div>
                            )}
                            {blData.port_of_loading && (
                              <div><span className="text-muted-foreground">Loading:</span> <span className="text-foreground">{blData.port_of_loading}</span></div>
                            )}
                            {blData.port_of_discharge && (
                              <div><span className="text-muted-foreground">Discharge:</span> <span className="text-foreground">{blData.port_of_discharge}</span></div>
                            )}
                            {blData.bl_number && (
                              <div><span className="text-muted-foreground">BL#:</span> <span className="text-foreground">{blData.bl_number}</span></div>
                            )}
                            {blData.vessel_name && (
                              <div><span className="text-muted-foreground">Vessel:</span> <span className="text-foreground">{blData.vessel_name}</span></div>
                            )}
                            {blData.container_numbers?.length > 0 && (
                              <div><span className="text-muted-foreground">Container:</span> <span className="text-foreground">{blData.container_numbers.join(', ')}</span></div>
                            )}
                            {blData.description && (
                              <div className="col-span-2"><span className="text-muted-foreground">Goods:</span> <span className="text-foreground">{blData.description}</span></div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>

            {/* Step 2: Details */}
            <AnimatePresence>
              {step >= 2 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6"
                >
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="bg-gradient-to-r from-accent/5 to-transparent">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Calculator className="w-5 h-5 text-primary" />
                        Step 2: Invoice Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-primary" />
                            Company Total Price ($)
                          </Label>
                          <Input
                            type="number"
                            placeholder="e.g. 7479"
                            value={companyPrice}
                            onChange={(e) => setCompanyPrice(e.target.value)}
                            className="text-lg"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Hash className="w-4 h-4 text-primary" />
                            Invoice Number
                          </Label>
                          <Input
                            placeholder="e.g. FL-GR-1302"
                            value={invoiceNumber}
                            onChange={(e) => setInvoiceNumber(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-primary" />
                            Number of Bales
                          </Label>
                          <Input
                            type="number"
                            placeholder="e.g. 32"
                            value={balesCount}
                            onChange={(e) => setBalesCount(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary" />
                            Invoice Date
                          </Label>
                          <Input
                            placeholder="DD-MM-YYYY"
                            value={invoiceDate}
                            onChange={(e) => setInvoiceDate(e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Template upload */}
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <FileUp className="w-4 h-4 text-primary" />
                            Original Invoice Template (Exact Same Output)
                        </Label>
                         <input ref={templateInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleTemplateUpload} className="hidden" />
                        <div
                          onClick={() => templateInputRef.current?.click()}
                          className="border border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all text-sm"
                        >
                          {extractingTemplate ? (
                            <div className="flex items-center justify-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                              <span className="text-muted-foreground">Analyzing template layout...</span>
                            </div>
                          ) : templateFile ? (
                            <div className="flex items-center justify-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                              <span className="text-foreground">{templateFile.name}</span>
                               <span className="text-xs text-green-600">(Exact template mode)</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">
                               Upload original template with logo/stamp — generated invoice will use the same paper layout exactly
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Calculation Preview */}
                      {calc && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="bg-muted/50 rounded-xl p-4 border border-border/50"
                        >
                          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                            <Eye className="w-4 h-4 text-primary" />
                            Calculation Preview
                          </h4>
                          <div className="grid grid-cols-4 gap-3 text-center">
                            <div>
                              <p className="text-xs text-muted-foreground">Weight</p>
                              <p className="text-lg font-bold text-foreground">{calc.kgs} KG</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Bales</p>
                              <p className="text-lg font-bold text-foreground">{balesCount || '-'}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Unit Price</p>
                              <p className="text-lg font-bold text-primary">${calc.unitPrice.toFixed(2)}/KG</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Total</p>
                              <p className="text-lg font-bold text-foreground">${calc.totalPrice.toLocaleString()}</p>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      <Button
                        onClick={generateInvoice}
                        disabled={!calc || generating}
                        className="w-full gap-2"
                        size="lg"
                      >
                        {generating ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating Invoice...
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4" />
                            Generate & Download Invoice PDF
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Step 3: Success */}
            <AnimatePresence>
              {step === 3 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6"
                >
                  <Card className="border-green-500/20 bg-green-500/5">
                    <CardContent className="p-6 text-center">
                      <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                      <h3 className="text-lg font-bold text-foreground mb-1">Invoice Generated Successfully!</h3>
                      <p className="text-sm text-muted-foreground mb-4">Your invoice PDF has been downloaded.</p>
                      <div className="flex gap-3 justify-center">
                        <Button variant="outline" onClick={resetAll} className="gap-2">
                          <RotateCcw className="w-4 h-4" />
                          Generate Another
                        </Button>
                        <Button onClick={generateInvoice} className="gap-2">
                          <Download className="w-4 h-4" />
                          Download Again
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Sidebar */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="border-border/50 shadow-sm sticky top-24">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Ship className="w-5 h-5 text-primary" />
                  How It Works
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { icon: Upload, title: 'Upload BL', desc: 'Upload your Bill of Lading (PDF or Image)' },
                  { icon: Sparkles, title: 'AI Extracts Data', desc: 'AI reads KGS, bales, shipper, consignee etc.' },
                  { icon: Calculator, title: 'Enter Price', desc: 'Enter total price, bales count, date' },
                  { icon: Download, title: 'Get Invoice', desc: 'Download invoice matching your template format' },
                ].map((item, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <item.icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}

                <div className="border-t border-border pt-4 mt-4">
                  <h4 className="text-sm font-semibold text-foreground mb-2">Template Placeholders</h4>
                  <div className="space-y-1 text-xs font-mono bg-muted/50 rounded-lg p-3">
                    {['{invoice_number}', '{date}', '{kgs}', '{bales}', '{unit_price}', '{total_price}', '{shipper}', '{consignee}', '{bl_number}', '{container_number}', '{vessel}', '{port_of_loading}', '{port_of_discharge}'].map(p => (
                      <div key={p} className="text-muted-foreground">{p}</div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
