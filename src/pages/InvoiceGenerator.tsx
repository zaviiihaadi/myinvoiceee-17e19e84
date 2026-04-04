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

interface TemplateLayout {
  title?: string | null;
  has_shipper_section?: boolean;
  has_consignee_section?: boolean;
  has_notify_party?: boolean;
  has_container_info?: boolean;
  has_vessel_section?: boolean;
  has_port_section?: boolean;
  has_hs_code?: boolean;
  has_goods_description?: boolean;
  has_shipping_marks?: boolean;
  has_weight_pricing?: boolean;
  has_bales_packages?: boolean;
  has_stamp_area?: boolean;
  company_name_position?: 'bottom' | 'top' | null;
  layout_style?: 'two-column' | 'single-column' | null;
  sections_order?: string[] | null;
}

GlobalWorkerOptions.workerSrc = pdfWorker;

const DEFAULT_TEMPLATE_PIXELS = { width: 1240, height: 1754 };
const DEFAULT_PAGE_FORMAT: [number, number] = [210, 297];
const PDF_FONT_FAMILY = 'helvetica';

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

const getTemplatePageMetrics = async (file: File | null) => {
  if (!file) return null;

  if (file.type === 'application/pdf') {
    const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    pdf.destroy();

    return {
      width: viewport.width,
      height: viewport.height,
    };
  }

  const src = await readFileAsDataUrl(file);
  const image = await loadImage(src);

  return {
    width: image.naturalWidth || DEFAULT_TEMPLATE_PIXELS.width,
    height: image.naturalHeight || DEFAULT_TEMPLATE_PIXELS.height,
  };
};

const getPdfPageFormat = (width: number, height: number): [number, number] => {
  if (!width || !height) return DEFAULT_PAGE_FORMAT;

  if (width > height) {
    const landscapeHeight = DEFAULT_PAGE_FORMAT[0];
    return [Number(((width / height) * landscapeHeight).toFixed(2)), landscapeHeight];
  }

  return [DEFAULT_PAGE_FORMAT[0], Number(((height / width) * DEFAULT_PAGE_FORMAT[0]).toFixed(2))];
};

type PdfTextAlign = 'left' | 'center' | 'right';

const normalizePdfText = (value: string | number | null | undefined) => String(value ?? '')
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')
  .split('\n')
  .map((line) => line.replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .join('\n');

const wrapPdfText = (doc: jsPDF, text: string, width: number) => {
  if (!text) return [] as string[];

  return text
    .split('\n')
    .flatMap((line) => {
      const wrapped = doc.splitTextToSize(line, width);
      return Array.isArray(wrapped) ? wrapped : [wrapped];
    })
    .filter(Boolean);
};

const drawTextBlock = (
  doc: jsPDF,
  {
    text,
    x,
    y,
    width,
    fontSize,
    lineHeight,
    align = 'left',
    bold = false,
    maxLines,
  }: {
    text: string;
    x: number;
    y: number;
    width: number;
    fontSize: number;
    lineHeight: number;
    align?: PdfTextAlign;
    bold?: boolean;
    maxLines?: number;
  },
) => {
  const lines = wrapPdfText(doc, normalizePdfText(text), width);
  const renderedLines = typeof maxLines === 'number' ? lines.slice(0, maxLines) : lines;

  doc.setFont(PDF_FONT_FAMILY, bold ? 'bold' : 'normal');
  doc.setFontSize(fontSize);

  renderedLines.forEach((line, index) => {
    const lineX = align === 'left' ? x : align === 'center' ? x + width / 2 : x + width;
    doc.text(line, lineX, y + index * lineHeight, { align });
  });
};

const formatCurrency = (value: number) => value.toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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
  const [templateLayout, setTemplateLayout] = useState<TemplateLayout | null>(null);
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
      toast.success('Template analyzed. Invoice will now be drawn directly without using a background image.');
    } catch (err: any) {
      console.error('Template extraction error:', err);
      toast.warning('Template uploaded. Invoice will still be generated with direct PDF drawing and no background image.');
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
    const templateMetrics = await getTemplatePageMetrics(templateFile);
    const pageFormat = templateMetrics
      ? getPdfPageFormat(templateMetrics.width, templateMetrics.height)
      : DEFAULT_PAGE_FORMAT;
    const doc = new jsPDF({
      orientation: pageFormat[0] > pageFormat[1] ? 'landscape' : 'portrait',
      unit: 'mm',
      format: pageFormat,
      compress: true,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const scaleX = pageWidth / DEFAULT_PAGE_FORMAT[0];
    const scaleY = pageHeight / DEFAULT_PAGE_FORMAT[1];
    const sx = (value: number) => Number((value * scaleX).toFixed(2));
    const sy = (value: number) => Number((value * scaleY).toFixed(2));
    const fontScale = Math.min(scaleX, scaleY);

    const outerLeft = sx(10);
    const outerTop = sy(10);
    const outerRight = pageWidth - sx(10);
    const outerBottom = pageHeight - sy(10);
    const outerWidth = outerRight - outerLeft;
    const outerHeight = outerBottom - outerTop;
    const midX = outerLeft + outerWidth / 2;
    const cellPaddingX = sx(3);
    const cellPaddingY = sy(5);
    const leftCellWidth = midX - outerLeft;
    const rightCellWidth = outerRight - midX;
    const headerBottom = sy(26);
    const shipperBottom = sy(72);
    const consigneeBottom = sy(118);
    const vesselBottom = sy(136);
    const portsBottom = sy(190);
    const totalsBottom = sy(222);
    const goodsMarksDivider = sy(174);
    const totalsDividerOne = sy(200);
    const totalsDividerTwo = sy(211);
    const stampBoxTop = sy(236);
    const labelFont = Math.max(7, 8 * fontScale);
    const bodyFont = Math.max(8, 9 * fontScale);
    const compactFont = Math.max(7.5, 8.5 * fontScale);
    const titleFont = Math.max(14, 16 * fontScale);
    const amountFont = Math.max(10, 11 * fontScale);
    const lineHeight = sy(4.1);
    const titleText = normalizePdfText(templateLayout?.title || 'INVOICE/PACKING') || 'INVOICE/PACKING';
    const shipperBlock = [blData?.shipper, blData?.shipper_address].filter(Boolean).join('\n');
    const consigneeBlock = [blData?.consignee, blData?.consignee_address].filter(Boolean).join('\n');
    const notifyBlock = [blData?.consignee || blData?.notify_party, blData?.consignee_address || blData?.notify_party_address].filter(Boolean).join('\n');
    const referenceBlock = [
      blData?.bl_number ? `BL NO: ${blData.bl_number}` : '',
      containerNums ? `CONTAINER: ${containerNums}` : '',
      blData?.shipping_marks ? `MARKS: ${blData.shipping_marks}` : '',
    ].filter(Boolean).join('\n');

    doc.setDrawColor(0);
    doc.setTextColor(0);
    doc.setLineWidth(Math.max(0.2, 0.25 * fontScale));
    doc.rect(outerLeft, outerTop, outerWidth, outerHeight);

    [headerBottom, shipperBottom, consigneeBottom, vesselBottom, portsBottom, totalsBottom].forEach((lineY) => {
      doc.line(outerLeft, lineY, outerRight, lineY);
    });

    doc.line(midX, headerBottom, midX, totalsBottom);
    doc.line(midX, totalsDividerOne, outerRight, totalsDividerOne);
    doc.line(midX, totalsDividerTwo, outerRight, totalsDividerTwo);

    if (templateLayout?.has_shipping_marks && blData?.shipping_marks) {
      doc.line(midX, goodsMarksDivider, outerRight, goodsMarksDivider);
    }

    if (templateLayout?.company_name_position === 'top' && blData?.shipper) {
      drawTextBlock(doc, {
        text: blData.shipper,
        x: outerLeft + cellPaddingX,
        y: sy(17),
        width: sx(66),
        fontSize: bodyFont,
        lineHeight,
        bold: true,
        maxLines: 1,
      });
    }

    doc.setFont(PDF_FONT_FAMILY, 'bold');
    doc.setFontSize(titleFont);
    doc.text(titleText, outerLeft + outerWidth / 2, sy(18), { align: 'center' });

    drawTextBlock(doc, {
      text: 'Invoice No.',
      x: midX + sx(16),
      y: sy(16.5),
      width: sx(28),
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: 'Date',
      x: midX + sx(52),
      y: sy(16.5),
      width: sx(22),
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: invNum,
      x: midX + sx(16),
      y: sy(22),
      width: sx(32),
      fontSize: bodyFont,
      lineHeight,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: date,
      x: midX + sx(52),
      y: sy(22),
      width: sx(24),
      fontSize: bodyFont,
      lineHeight,
      maxLines: 1,
    });

    drawTextBlock(doc, {
      text: '1. SHIPPER',
      x: outerLeft + cellPaddingX,
      y: headerBottom + cellPaddingY,
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: shipperBlock,
      x: outerLeft + cellPaddingX,
      y: headerBottom + sy(11),
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: compactFont,
      lineHeight,
      maxLines: 7,
    });

    drawTextBlock(doc, {
      text: 'NOTIFY PARTY',
      x: midX + cellPaddingX,
      y: headerBottom + cellPaddingY,
      width: rightCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: notifyBlock,
      x: midX + cellPaddingX,
      y: headerBottom + sy(11),
      width: rightCellWidth - cellPaddingX * 2,
      fontSize: compactFont,
      lineHeight,
      maxLines: 7,
    });

    drawTextBlock(doc, {
      text: '2. CONSIGNEE',
      x: outerLeft + cellPaddingX,
      y: shipperBottom + cellPaddingY,
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: consigneeBlock,
      x: outerLeft + cellPaddingX,
      y: shipperBottom + sy(11),
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: compactFont,
      lineHeight,
      maxLines: 7,
    });

    drawTextBlock(doc, {
      text: 'CONTAINER / SIZE',
      x: midX + cellPaddingX,
      y: shipperBottom + cellPaddingY,
      width: rightCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: [containerSize, containerNums].filter(Boolean).join('\n'),
      x: midX + cellPaddingX,
      y: shipperBottom + sy(11),
      width: rightCellWidth - cellPaddingX * 2,
      fontSize: bodyFont,
      lineHeight,
      maxLines: 5,
    });

    drawTextBlock(doc, {
      text: 'VESSEL / FLIGHT',
      x: outerLeft + cellPaddingX,
      y: consigneeBottom + cellPaddingY,
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: blData?.vessel_name || '',
      x: outerLeft + cellPaddingX,
      y: consigneeBottom + sy(11),
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: bodyFont,
      lineHeight,
      maxLines: 2,
    });

    drawTextBlock(doc, {
      text: 'HS CODE',
      x: midX + cellPaddingX,
      y: consigneeBottom + cellPaddingY,
      width: rightCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: blData?.hs_code || '',
      x: midX + cellPaddingX,
      y: consigneeBottom + sy(11),
      width: rightCellWidth - cellPaddingX * 2,
      fontSize: bodyFont,
      lineHeight,
      maxLines: 2,
    });

    drawTextBlock(doc, {
      text: 'PORT OF LOADING',
      x: outerLeft + cellPaddingX,
      y: vesselBottom + cellPaddingY,
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: blData?.port_of_loading || '',
      x: outerLeft + cellPaddingX,
      y: vesselBottom + sy(11),
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: bodyFont,
      lineHeight,
      maxLines: 3,
    });
    drawTextBlock(doc, {
      text: 'PORT OF DISCHARGE / DESTINATION',
      x: outerLeft + cellPaddingX,
      y: sy(164),
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 2,
    });
    drawTextBlock(doc, {
      text: blData?.port_of_discharge || '',
      x: outerLeft + cellPaddingX,
      y: sy(171),
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: bodyFont,
      lineHeight,
      maxLines: 3,
    });

    drawTextBlock(doc, {
      text: 'GOODS DESCRIPTION',
      x: midX + cellPaddingX,
      y: vesselBottom + cellPaddingY,
      width: rightCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: blData?.description || '',
      x: midX + cellPaddingX,
      y: vesselBottom + sy(11),
      width: rightCellWidth - cellPaddingX * 2,
      fontSize: compactFont,
      lineHeight,
      maxLines: templateLayout?.has_shipping_marks && blData?.shipping_marks ? 5 : 8,
    });

    if (templateLayout?.has_shipping_marks && blData?.shipping_marks) {
      drawTextBlock(doc, {
        text: 'SHIPPING MARKS',
        x: midX + cellPaddingX,
        y: goodsMarksDivider + cellPaddingY,
        width: rightCellWidth - cellPaddingX * 2,
        fontSize: labelFont,
        lineHeight,
        bold: true,
        maxLines: 1,
      });
      drawTextBlock(doc, {
        text: blData.shipping_marks,
        x: midX + cellPaddingX,
        y: goodsMarksDivider + sy(11),
        width: rightCellWidth - cellPaddingX * 2,
        fontSize: compactFont,
        lineHeight,
        maxLines: 3,
      });
    }

    drawTextBlock(doc, {
      text: templateLayout?.has_bales_packages === false ? 'PACKAGES' : 'NO. & KIND OF PKGS',
      x: outerLeft + cellPaddingX,
      y: portsBottom + cellPaddingY,
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });

    doc.setFont(PDF_FONT_FAMILY, 'normal');
    doc.setFontSize(bodyFont + 1);
    doc.text(bales ? `${bales} BALES` : '', outerLeft + leftCellWidth / 2, sy(207), { align: 'center' });

    drawTextBlock(doc, {
      text: templateLayout?.has_weight_pricing === false ? 'WEIGHT' : 'G.WEIGHT',
      x: midX + cellPaddingX,
      y: portsBottom + sy(8),
      width: sx(24),
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: `${calc.kgs.toFixed(4)} KGS`,
      x: midX + sx(30),
      y: portsBottom + sy(8),
      width: rightCellWidth - sx(34),
      fontSize: bodyFont,
      lineHeight,
      align: 'right',
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: 'UNIT PRICE',
      x: midX + cellPaddingX,
      y: totalsDividerOne + sy(8),
      width: sx(24),
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: `${calc.unitPrice.toFixed(2)} US$ PER KG`,
      x: midX + sx(28),
      y: totalsDividerOne + sy(8),
      width: rightCellWidth - sx(32),
      fontSize: bodyFont,
      lineHeight,
      align: 'right',
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: 'AMOUNT',
      x: midX + cellPaddingX,
      y: totalsDividerTwo + sy(7.5),
      width: sx(24),
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: `${formatCurrency(calc.totalPrice)} US$`,
      x: midX + sx(26),
      y: totalsDividerTwo + sy(8),
      width: rightCellWidth - sx(30),
      fontSize: amountFont,
      lineHeight,
      align: 'right',
      maxLines: 1,
    });

    drawTextBlock(doc, {
      text: 'REFERENCE',
      x: outerLeft + cellPaddingX,
      y: sy(236),
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: labelFont,
      lineHeight,
      bold: true,
      maxLines: 1,
    });
    drawTextBlock(doc, {
      text: referenceBlock,
      x: outerLeft + cellPaddingX,
      y: sy(243),
      width: leftCellWidth - cellPaddingX * 2,
      fontSize: compactFont,
      lineHeight,
      maxLines: 5,
    });

    if (templateLayout?.has_stamp_area !== false) {
      doc.rect(midX + sx(18), stampBoxTop, sx(68), sy(30));
      drawTextBlock(doc, {
        text: 'AUTHORIZED SIGNATURE / STAMP',
        x: midX + sx(21),
        y: stampBoxTop + sy(24),
        width: sx(62),
        fontSize: labelFont,
        lineHeight,
        align: 'center',
        bold: true,
        maxLines: 1,
      });
    }

    if (templateLayout?.company_name_position !== 'top') {
      drawTextBlock(doc, {
        text: blData?.shipper || 'COMPANY NAME',
        x: outerLeft,
        y: pageHeight - sy(16),
        width: outerWidth,
        fontSize: bodyFont,
        lineHeight,
        align: 'center',
        bold: true,
        maxLines: 1,
      });
    }

    return doc;
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
            Upload your BL, extract data automatically, and generate a clean invoice PDF drawn to match your template layout.
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
                            Original Invoice Template (Reference Only)
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
                               <span className="text-xs text-green-600">(Direct PDF mode)</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">
                               Upload original template as reference — invoice will be drawn directly, not as a background image
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
                  { icon: Download, title: 'Get Invoice', desc: 'Download a directly drawn invoice matching your template format' },
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
