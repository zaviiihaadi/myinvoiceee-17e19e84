import { useEffect, useRef, useState } from 'react';
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
  Sparkles, Ship, FileUp, Eye, Package, RotateCcw, FileSpreadsheet, X
} from 'lucide-react';

interface ExcelRow {
  container: string;
  invoice: string;
  price: string;
}

const normalizeContainerKey = (s: string): string =>
  (s || '').toString().toUpperCase().replace(/[\s\-_.,:;#'"]/g, '');

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


interface TemplateBox {
  x: number;
  y: number;
  w: number;
  h: number;
  align?: 'left' | 'center' | 'right' | null;
  font_size?: number | null;
  max_lines?: number | null;
  bold?: boolean | null;
}

type PdfTextAlign = 'left' | 'center' | 'right';

type TemplateFieldKey =
  | 'invoice_number'
  | 'date'
  | 'shipper'
  | 'consignee'
  | 'notify_party'
  | 'container_info'
  | 'vessel'
  | 'hs_code'
  | 'port_of_loading'
  | 'port_of_discharge'
  | 'goods_description'
  | 'shipping_marks'
  | 'packages'
  | 'gross_weight'
  | 'unit_price'
  | 'amount'
  | 'reference'
  | 'company_name';

interface TemplateFieldLayout {
  key: TemplateFieldKey;
  label?: string | null;
  label_box?: TemplateBox | null;
  value_box?: TemplateBox | null;
}

interface TemplateStaticText {
  text: string;
  box: TemplateBox;
}

interface TemplateImageRegion {
  key: 'logo' | 'stamp';
  box: TemplateBox;
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
  show_lines?: boolean;
  use_exact_positions?: boolean;
  fields?: TemplateFieldLayout[] | null;
  static_texts?: TemplateStaticText[] | null;
  image_regions?: TemplateImageRegion[] | null;
}

GlobalWorkerOptions.workerSrc = pdfWorker;

const DEFAULT_TEMPLATE_PIXELS = { width: 1240, height: 1754 };
const DEFAULT_PAGE_FORMAT: [number, number] = [210, 297];
const PDF_FONT_FAMILY = 'helvetica';
const TEMPLATE_FIELD_KEYS: TemplateFieldKey[] = [
  'invoice_number',
  'date',
  'shipper',
  'consignee',
  'notify_party',
  'container_info',
  'vessel',
  'hs_code',
  'port_of_loading',
  'port_of_discharge',
  'goods_description',
  'shipping_marks',
  'packages',
  'gross_weight',
  'unit_price',
  'amount',
  'reference',
  'company_name',
];

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const createNormalizedBox = (
  xMm: number,
  yMm: number,
  wMm: number,
  hMm: number,
  options: Partial<Omit<TemplateBox, 'x' | 'y' | 'w' | 'h'>> = {},
): TemplateBox => ({
  x: Number((xMm / DEFAULT_PAGE_FORMAT[0]).toFixed(4)),
  y: Number((yMm / DEFAULT_PAGE_FORMAT[1]).toFixed(4)),
  w: Number((wMm / DEFAULT_PAGE_FORMAT[0]).toFixed(4)),
  h: Number((hMm / DEFAULT_PAGE_FORMAT[1]).toFixed(4)),
  ...options,
});

const normalizeTemplateBox = (box: TemplateBox | null | undefined): TemplateBox | null => {
  if (!box || ![box.x, box.y, box.w, box.h].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }

  const x = clamp(box.x, 0, 0.98);
  const y = clamp(box.y, 0, 0.98);

  return {
    x,
    y,
    w: clamp(box.w, 0.02, 1 - x),
    h: clamp(box.h, 0.02, 1 - y),
    align: box.align === 'center' || box.align === 'right' ? box.align : 'left',
    font_size: typeof box.font_size === 'number' && Number.isFinite(box.font_size) ? box.font_size : undefined,
    max_lines: typeof box.max_lines === 'number' && Number.isFinite(box.max_lines) ? Math.max(1, Math.round(box.max_lines)) : undefined,
    bold: typeof box.bold === 'boolean' ? box.bold : undefined,
  };
};

const DEFAULT_TEMPLATE_LAYOUT: TemplateLayout = {
  title: 'INVOICE/PACKING',
  has_shipper_section: true,
  has_consignee_section: true,
  has_notify_party: true,
  has_container_info: true,
  has_vessel_section: true,
  has_port_section: true,
  has_hs_code: true,
  has_goods_description: true,
  has_shipping_marks: true,
  has_weight_pricing: true,
  has_bales_packages: true,
  has_stamp_area: true,
  company_name_position: 'bottom',
  layout_style: 'two-column',
  sections_order: [
    'shipper',
    'notify_party',
    'consignee',
    'container',
    'vessel',
    'ports',
    'goods',
    'weight',
    'reference',
    'company',
  ],
  show_lines: false,
  use_exact_positions: true,
  static_texts: [
    { text: 'INVOICE/PACKING', box: createNormalizedBox(50, 8, 110, 10, { align: 'center', font_size: 16, max_lines: 1, bold: true }) },
    { text: 'Invoice No.', box: createNormalizedBox(119, 22, 25, 5, { font_size: 8, bold: true }) },
    { text: 'Date', box: createNormalizedBox(168, 22, 15, 5, { font_size: 8, bold: true }) },
  ],
  fields: [
    { key: 'invoice_number', label: '', value_box: createNormalizedBox(144, 22, 22, 5, { font_size: 9, max_lines: 1 }) },
    { key: 'date', label: '', value_box: createNormalizedBox(183, 22, 22, 5, { font_size: 9, max_lines: 1 }) },
    { key: 'shipper', label: '1.Shipper', label_box: createNormalizedBox(10, 28, 95, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(10, 35, 95, 28, { font_size: 8.5, max_lines: 6 }) },
    { key: 'notify_party', label: 'NOTIFY PARTY', label_box: createNormalizedBox(119, 36, 80, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(119, 43, 80, 24, { font_size: 8.5, max_lines: 5 }) },
    { key: 'consignee', label: '2.Consignee', label_box: createNormalizedBox(10, 92, 95, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(10, 99, 95, 24, { font_size: 8.5, max_lines: 5 }) },
    { key: 'container_info', label: 'CONTAINER NO:', label_box: createNormalizedBox(119, 113, 80, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(119, 92, 80, 18, { font_size: 9, max_lines: 3 }) },
    { key: 'vessel', label: 'VESSEL / FLIGHT', label_box: createNormalizedBox(10, 140, 95, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(10, 148, 95, 10, { font_size: 9, max_lines: 2 }) },
    { key: 'port_of_discharge', label: '', value_box: createNormalizedBox(10, 162, 95, 10, { font_size: 9, max_lines: 2 }) },
    { key: 'hs_code', label: 'HS CODE:', label_box: createNormalizedBox(119, 150, 25, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(146, 150, 52, 6, { font_size: 9, max_lines: 1 }) },
    { key: 'goods_description', label: 'Goods Description', label_box: createNormalizedBox(119, 160, 80, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(119, 168, 80, 10, { font_size: 8.5, max_lines: 3 }) },
    { key: 'port_of_loading', label: 'Port of Loading', label_box: createNormalizedBox(10, 178, 95, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(10, 186, 95, 10, { font_size: 9, max_lines: 2 }) },
    { key: 'gross_weight', label: 'G.Weight', label_box: createNormalizedBox(119, 184, 30, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(150, 184, 48, 6, { font_size: 9.5, max_lines: 1, align: 'right' }) },
    { key: 'unit_price', label: 'Unit Price', label_box: createNormalizedBox(119, 193, 30, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(150, 193, 48, 6, { font_size: 9.5, max_lines: 1, align: 'right' }) },
    { key: 'amount', label: 'Amount', label_box: createNormalizedBox(119, 202, 30, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(150, 202, 48, 7, { font_size: 11, max_lines: 1, align: 'right', bold: true }) },
    { key: 'shipping_marks', label: 'SHIPPING MARKS', label_box: createNormalizedBox(10, 215, 95, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(15, 223, 90, 10, { font_size: 8.5, max_lines: 2 }) },
    { key: 'packages', label: 'No.& Kind of Pkgs', label_box: createNormalizedBox(25, 243, 75, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(25, 251, 75, 8, { font_size: 10, max_lines: 1, bold: true, align: 'center' }) },
    { key: 'reference', label: 'REFERENCE', label_box: createNormalizedBox(10, 262, 95, 5, { font_size: 8, bold: true }), value_box: createNormalizedBox(10, 270, 95, 18, { font_size: 8.5, max_lines: 4 }) },
    { key: 'company_name', value_box: createNormalizedBox(119, 267, 80, 8, { font_size: 10, max_lines: 1, align: 'center', bold: true }) },
  ],
  image_regions: [],
};

const mergeTemplateFields = (
  fallbackFields: TemplateFieldLayout[],
  incomingFields: TemplateFieldLayout[] | null | undefined,
): TemplateFieldLayout[] => {
  const merged = new Map<TemplateFieldKey, TemplateFieldLayout>();

  fallbackFields.forEach((field) => {
    merged.set(field.key, {
      ...field,
      label_box: normalizeTemplateBox(field.label_box),
      value_box: normalizeTemplateBox(field.value_box),
    });
  });

  (incomingFields ?? []).forEach((field) => {
    if (!field || !TEMPLATE_FIELD_KEYS.includes(field.key)) return;

    const base = merged.get(field.key) ?? { key: field.key };

    merged.set(field.key, {
      ...base,
      ...field,
      label: field.label ?? base.label,
      label_box: normalizeTemplateBox(field.label_box) ?? base.label_box ?? null,
      value_box: normalizeTemplateBox(field.value_box) ?? base.value_box ?? null,
    });
  });

  return Array.from(merged.values());
};

const mergeStaticTexts = (incoming: TemplateStaticText[] | null | undefined): TemplateStaticText[] => {
  const normalized = (incoming ?? [])
    .map((item) => {
      const box = normalizeTemplateBox(item?.box);
      if (!box || !item?.text?.trim()) return null;
      return { text: item.text.trim(), box };
    })
    .filter((item): item is TemplateStaticText => Boolean(item));

  return normalized.length ? normalized : (DEFAULT_TEMPLATE_LAYOUT.static_texts ?? []);
};

const mergeImageRegions = (incoming: TemplateImageRegion[] | null | undefined): TemplateImageRegion[] => (
  (incoming ?? [])
    .map((region) => {
      const box = normalizeTemplateBox(region?.box);
      if (!box || (region?.key !== 'logo' && region?.key !== 'stamp')) return null;
      return { key: region.key, box };
    })
    .filter((item): item is TemplateImageRegion => Boolean(item))
);

const resolveTemplateLayout = (layout: TemplateLayout | null | undefined): TemplateLayout => ({
  ...DEFAULT_TEMPLATE_LAYOUT,
  ...layout,
  show_lines: false,
  use_exact_positions: true,
  static_texts: mergeStaticTexts(layout?.static_texts),
  fields: mergeTemplateFields(DEFAULT_TEMPLATE_LAYOUT.fields ?? [], layout?.fields),
  image_regions: mergeImageRegions(layout?.image_regions),
});

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

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = src;
});

const renderTemplateFileToCanvas = async (file: File, scale = 2) => {
  if (file.type === 'application/pdf') {
    const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;

    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas context not available');
      }

      await page.render({ canvasContext: context, viewport, canvas }).promise;
      return canvas;
    } finally {
      pdf.destroy();
    }
  }

  const src = await readFileAsDataUrl(file);
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || DEFAULT_TEMPLATE_PIXELS.width;
  canvas.height = image.naturalHeight || DEFAULT_TEMPLATE_PIXELS.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas context not available');
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const extractRegionFromCanvas = (sourceCanvas: HTMLCanvasElement, box: TemplateBox | null | undefined) => {
  const region = normalizeTemplateBox(box);
  if (!region) return null;

  const sourceX = Math.round(region.x * sourceCanvas.width);
  const sourceY = Math.round(region.y * sourceCanvas.height);
  const sourceWidth = Math.min(Math.round(region.w * sourceCanvas.width), sourceCanvas.width - sourceX);
  const sourceHeight = Math.min(Math.round(region.h * sourceCanvas.height), sourceCanvas.height - sourceY);

  if (sourceWidth <= 2 || sourceHeight <= 2) return null;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = sourceWidth;
  cropCanvas.height = sourceHeight;

  const cropContext = cropCanvas.getContext('2d');
  if (!cropContext) return null;

  cropContext.drawImage(
    sourceCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  return cropCanvas.toDataURL('image/png');
};

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

const truncatePdfLine = (doc: jsPDF, text: string, maxWidth: number) => {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (doc.getTextWidth(trimmed) <= maxWidth) return trimmed;

  let candidate = trimmed;
  while (candidate.length > 1 && doc.getTextWidth(`${candidate}…`) > maxWidth) {
    candidate = candidate.slice(0, -1).trimEnd();
  }

  return candidate ? `${candidate}…` : '…';
};

const clampPdfLines = (doc: jsPDF, lines: string[], maxLines: number, maxWidth: number) => {
  if (lines.length <= maxLines) return lines;
  if (maxLines <= 0) return [] as string[];

  const trimmed = lines.slice(0, maxLines);
  trimmed[maxLines - 1] = truncatePdfLine(doc, trimmed[maxLines - 1] || '', maxWidth);
  return trimmed;
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
  // CRITICAL: Set font BEFORE wrapping so splitTextToSize uses correct metrics
  doc.setFont(PDF_FONT_FAMILY, bold ? 'bold' : 'normal');
  doc.setFontSize(fontSize);

  const lines = wrapPdfText(doc, normalizePdfText(text), width);
  const renderedLines = typeof maxLines === 'number' ? lines.slice(0, maxLines) : lines;

  renderedLines.forEach((line, index) => {
    const lineX = align === 'left' ? x : align === 'center' ? x + width / 2 : x + width;
    doc.text(line, lineX, y + index * lineHeight, { align });
  });
};

interface PersistedInvoiceTemplate {
  blob: Blob;
  layout: TemplateLayout | null;
  name: string;
  type: string;
}

const INVOICE_TEMPLATE_DB_NAME = 'shipahead-invoice-generator';
const INVOICE_TEMPLATE_STORE = 'invoice-template-store';

const openInvoiceTemplateDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = window.indexedDB.open(INVOICE_TEMPLATE_DB_NAME, 1);

  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(INVOICE_TEMPLATE_STORE)) {
      db.createObjectStore(INVOICE_TEMPLATE_STORE);
    }
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Failed to open template storage'));
});

const loadPersistedInvoiceTemplate = async (storageKey: string): Promise<PersistedInvoiceTemplate | null> => {
  const db = await openInvoiceTemplateDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(INVOICE_TEMPLATE_STORE, 'readonly');
    const request = transaction.objectStore(INVOICE_TEMPLATE_STORE).get(storageKey);

    request.onsuccess = () => resolve((request.result as PersistedInvoiceTemplate | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Failed to load saved template'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to load saved template'));
  });
};

const savePersistedInvoiceTemplate = async (storageKey: string, template: PersistedInvoiceTemplate) => {
  const db = await openInvoiceTemplateDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(INVOICE_TEMPLATE_STORE, 'readwrite');
    transaction.objectStore(INVOICE_TEMPLATE_STORE).put(template, storageKey);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to save template'));
  });
};

const removePersistedInvoiceTemplate = async (storageKey: string) => {
  const db = await openInvoiceTemplateDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(INVOICE_TEMPLATE_STORE, 'readwrite');
    transaction.objectStore(INVOICE_TEMPLATE_STORE).delete(storageKey);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to remove template'));
  });
};

const normalizeAmountInput = (value: string) => value.replace(/,/g, '').trim();

const normalizeDecimalForMath = (value: string) => {
  const normalized = normalizeAmountInput(value);
  if (!/^(?:\d+|\d*\.\d+)$/.test(normalized)) return null;

  const [integerRaw = '0', decimalRaw = ''] = normalized.split('.');
  const integerPart = integerRaw.replace(/^0+(?=\d)/, '') || '0';
  const decimalPart = decimalRaw.replace(/0+$/, '');

  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
};

const parseDecimalParts = (value: string) => {
  const normalized = normalizeDecimalForMath(value);
  if (!normalized) return null;

  const [integerPart = '0', decimalPart = ''] = normalized.split('.');
  return {
    normalized,
    scale: decimalPart.length,
    value: BigInt(`${integerPart}${decimalPart}` || '0'),
  };
};

const compareDecimalStrings = (left: string, right: string) => {
  const leftParts = parseDecimalParts(left);
  const rightParts = parseDecimalParts(right);
  if (!leftParts || !rightParts) return 0;

  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.value * (10n ** BigInt(scale - leftParts.scale));
  const rightValue = rightParts.value * (10n ** BigInt(scale - rightParts.scale));

  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? 1 : -1;
};

const divideDecimalStrings = (numerator: string, denominator: string, precision = 6) => {
  const numeratorParts = parseDecimalParts(numerator);
  const denominatorParts = parseDecimalParts(denominator);
  if (!numeratorParts || !denominatorParts || denominatorParts.value === 0n) return null;

  const precisionFactor = 10n ** BigInt(precision);
  const scaledNumerator = numeratorParts.value * precisionFactor * (10n ** BigInt(denominatorParts.scale));
  const scaledDenominator = denominatorParts.value * (10n ** BigInt(numeratorParts.scale));
  const quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  const roundedQuotient = remainder * 2n >= scaledDenominator ? quotient + 1n : quotient;

  const integerPart = roundedQuotient / precisionFactor;
  const decimalPart = (roundedQuotient % precisionFactor).toString().padStart(precision, '0').replace(/0+$/, '');

  return decimalPart ? `${integerPart.toString()}.${decimalPart}` : integerPart.toString();
};

const multiplyDecimalStrings = (a: string, b: string, maxDecimals = 3) => {
  const aParts = parseDecimalParts(a);
  const bParts = parseDecimalParts(b);
  if (!aParts || !bParts) return null;
  const product = aParts.value * bParts.value;
  const totalScale = aParts.scale + bParts.scale;
  let str = product.toString().padStart(totalScale + 1, '0');
  let intPart = totalScale ? str.slice(0, -totalScale) : str;
  let decPart = totalScale ? str.slice(-totalScale) : '';
  if (decPart.length > maxDecimals) {
    decPart = decPart.slice(0, maxDecimals);
  }
  return decPart ? `${intPart}.${decPart}` : intPart;
};


const formatCalculatedDecimal = (normalized: string, minimumFractionDigits = 2) => {
  const [integerPart = '0', decimalPart = ''] = normalized.split('.');
  const trimmedDecimal = decimalPart.replace(/0+$/, '');
  const finalDecimal = trimmedDecimal.length
    ? trimmedDecimal.length < minimumFractionDigits
      ? trimmedDecimal.padEnd(minimumFractionDigits, '0')
      : trimmedDecimal
    : minimumFractionDigits
      ? ''.padEnd(minimumFractionDigits, '0')
      : '';

  return finalDecimal ? `${integerPart}.${finalDecimal}` : integerPart;
};

const parseExactAmountInput = (value: string) => {
  const normalized = normalizeAmountInput(value);
  if (!normalized || !/^(?:\d+|\d*\.\d+)$/.test(normalized)) return null;

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;

  return { amount, normalized, normalizedForMath: normalizeDecimalForMath(normalized) ?? normalized };
};

const formatExactAmount = (normalized: string) => {
  const [integerPart = '0', decimalPart] = normalized.split('.');
  const sanitizedInteger = (integerPart || '0').replace(/^0+(?=\d)/, '') || '0';
  const groupedInteger = sanitizedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return decimalPart !== undefined ? `${groupedInteger}.${decimalPart}` : groupedInteger;
};

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

function normalizeDateString(input: string | null | undefined): string {
  if (!input) return '';
  const s = String(input).trim();
  if (!s) return '';
  // Match dd<sep>mm-or-monthname<sep>yy(yy)
  const m = s.match(/^(\d{1,2})[\/\-\s.]+([A-Za-z]+|\d{1,2})[\/\-\s.]+(\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    let mm = m[2];
    if (/^[A-Za-z]+$/.test(mm)) {
      const key = mm.toLowerCase().slice(0, mm.toLowerCase().startsWith('sept') ? 4 : 3);
      mm = MONTH_MAP[key] || MONTH_MAP[mm.toLowerCase().slice(0, 3)] || '01';
    } else {
      mm = mm.padStart(2, '0');
    }
    let yy = m[3];
    if (yy.length === 2) yy = `20${yy}`;
    else if (yy.length === 4) yy = yy;
    else yy = `20${yy.padStart(2, '0')}`;
    return `${dd}/${mm}/${yy}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear());
    return `${dd}/${mm}/${yy}`;
  }
  return s;
}

function todayDDMMYY(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

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
  const [invoiceDate, setInvoiceDate] = useState(() => todayDDMMYY());
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [blData, setBlData] = useState<BLData | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [templateLayout, setTemplateLayout] = useState<TemplateLayout | null>(null);
  const [extractingTemplate, setExtractingTemplate] = useState(false);
  const [excelRows, setExcelRows] = useState<ExcelRow[]>([]);
  const [excelFileName, setExcelFileName] = useState<string | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);
  const [matchedRow, setMatchedRow] = useState<ExcelRow | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const templateStorageKey = user?.id ? `invoice-template:${user.id}` : null;

  useEffect(() => {
    if (!templateStorageKey) return;

    let cancelled = false;

    const restoreTemplate = async () => {
      try {
        const savedTemplate = await loadPersistedInvoiceTemplate(templateStorageKey);
        if (!savedTemplate || cancelled) return;

        const restoredFile = new File([savedTemplate.blob], savedTemplate.name, {
          type: savedTemplate.type,
          lastModified: Date.now(),
        });

        setTemplateFile(restoredFile);
        setTemplateLayout(savedTemplate.layout ?? null);
      } catch (error) {
        console.error('Failed to restore saved invoice template:', error);
      }
    };

    void restoreTemplate();

    return () => {
      cancelled = true;
    };
  }, [templateStorageKey]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [authLoading, user, navigate]);

  if (authLoading || !user) return <div className="min-h-screen bg-background" />;

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

  const name = file.name.toLowerCase();
  const isDocx = name.endsWith('.docx') || name.endsWith('.doc') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  if (isDocx) {
    // DOCX -> Adobe handles merge tags inside the document. Skip AI layout extraction.
    setTemplateLayout(null);
    if (templateStorageKey) {
      try {
        await savePersistedInvoiceTemplate(templateStorageKey, {
          blob: file,
          layout: null,
          name: file.name,
          type: file.type,
        });
      } catch (storageError) {
        console.error('Failed to persist invoice template:', storageError);
      }
    }
    toast.success('Word template ready. Adobe API merge tags ({{invoice_number}} etc.) ka use karega — spacing & stamp 100% same.');
    return;
  }

  setExtractingTemplate(true);
  let extractedLayout: TemplateLayout | null = null;
  try {
    const base64 = await readFileAsBase64(file);

    const { data, error } = await supabase.functions.invoke('extract-template-layout', {
      body: { fileBase64: base64, mimeType: file.type },
    });

    if (error) throw error;

    extractedLayout = data;
    setTemplateLayout(data);
    toast.success('PDF template mapped. Original PDF ke upar text overlay hoga — stamp & spacing 100% same.');
  } catch (err: any) {
    console.error('Template extraction error:', err);
    setTemplateLayout(null);
    toast.warning(err.message || 'Template AI mapping fail hua. Fallback line-free layout use hoga.');
  } finally {
    if (templateStorageKey) {
      try {
        await savePersistedInvoiceTemplate(templateStorageKey, {
          blob: file,
          layout: extractedLayout,
          name: file.name,
          type: file.type,
        });
      } catch (storageError) {
        console.error('Failed to persist invoice template:', storageError);
      }
    }
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

      // Merge notify party name + address into a single field (avoid duplicate address)
      const notifyName = (data?.notify_party || '').trim();
      const notifyAddr = (data?.notify_party_address || '').trim();
      const notifyAlreadyHasAddr = notifyAddr && notifyName.toLowerCase().includes(notifyAddr.toLowerCase());
      const mergedNotify = notifyAlreadyHasAddr || !notifyAddr
        ? notifyName
        : [notifyName, notifyAddr].filter(Boolean).join('\n');

      // Clean goods description: strip "SAID TO CONTAIN ..." prefixes, start at MIX/USED CLOTHING
      let cleanedDescription = (data?.description || '').trim();
      if (cleanedDescription) {
        const match = cleanedDescription.match(/(MIX(?:ED)?\s+USED\s+CLOTHING|USED\s+CLOTHING)[\s\S]*/i);
        if (match) cleanedDescription = match[0].trim();
        // Remove leading container/bales boilerplate if still present
        cleanedDescription = cleanedDescription.replace(/^SAID\s+TO\s+CONTAIN[^A-Za-z]*\d*\s*X?\s*\d*[A-Z0-9]*\s*\d*\s*BALES?\s*[:\-]?\s*/i, '').trim();
      }

      const normalizedData = { ...data, notify_party: mergedNotify, notify_party_address: '', description: cleanedDescription };

      if (data.kgs) {
        setBlData(normalizedData);
        if (data.bales) setBalesCount(String(data.bales));
        if (data.bl_number) setInvoiceNumber(data.bl_number);
        if (data.bl_date) setInvoiceDate(normalizeDateString(data.bl_date));
        setStep(2);
        toast.success(`KGS extracted: ${data.kgs} kg`);
        tryAutoFillFromExcel(normalizedData.container_numbers || []);
      } else {
        setBlData(normalizedData);
        toast.error('Could not extract weight (KGS) from the BL. Please check the file.');
        tryAutoFillFromExcel(normalizedData.container_numbers || []);
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
    const parsedAmount = parseExactAmountInput(companyPrice);
    if (!parsedAmount) return null;
    const normalizedWeight = normalizeDecimalForMath(String(blData.kgs));
    if (!normalizedWeight) return null;

    // Unit Price = Company Total Price ÷ Weight, TRUNCATED to exactly 2 decimals
    const companyPriceNum = Number(parsedAmount.normalizedForMath);
    const weightNum = Number(normalizedWeight);
    if (!isFinite(companyPriceNum) || !isFinite(weightNum) || weightNum === 0) return null;
    const rawUnitPrice = companyPriceNum / weightNum;
    const unitPriceNum = Math.floor(rawUnitPrice * 100) / 100;
    const unitPriceTextExact = unitPriceNum.toFixed(2); // always 2 decimals after truncation: 0.40, 0.53, 1.00

    // Total = displayed unit price × weight, truncated to 3 decimals with no post-rounding
    const computedTotalRaw = multiplyDecimalStrings(unitPriceTextExact, normalizedWeight, 3) ?? parsedAmount.normalized;
    const computedTotalText = formatCalculatedDecimal(computedTotalRaw, 3);

    return {
      unitPrice: unitPriceNum,
      unitPriceText: unitPriceTextExact,
      totalPriceDisplay: formatExactAmount(computedTotalText),
      totalPriceText: computedTotalText,
      kgs: blData.kgs,
    };
  };



const generateInvoicePDF = async (calc: {
  unitPrice: number;
  unitPriceText: string;
  totalPriceDisplay: string;
  totalPriceText: string;
  kgs: number;
}) => {
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
  const fontScale = Math.min(pageWidth / DEFAULT_PAGE_FORMAT[0], pageHeight / DEFAULT_PAGE_FORMAT[1]);
  const resolvedLayout = resolveTemplateLayout(templateLayout);
  const fieldMap = new Map<TemplateFieldKey, TemplateFieldLayout>(
    (resolvedLayout.fields ?? []).map((field) => [field.key, field] as const),
  );
  const imageRegionMap = new Map<'logo' | 'stamp', TemplateBox>(
    (resolvedLayout.image_regions ?? []).map((region) => [region.key, region.box] as const),
  );
  const templateCanvas = templateFile ? await renderTemplateFileToCanvas(templateFile, 2) : null;
  const shipperBlock = [blData?.shipper, blData?.shipper_address].filter(Boolean).join('\n');
  const consigneeBlock = [blData?.consignee, blData?.consignee_address].filter(Boolean).join('\n');
  const notifyBlock = blData?.notify_party || [blData?.consignee, blData?.consignee_address].filter(Boolean).join('\n');
  const referenceBlock = [
    blData?.bl_number ? `BL NO: ${blData.bl_number}` : '',
    containerNums ? `CONTAINER: ${containerNums}` : '',
    blData?.shipping_marks ? `MARKS: ${blData.shipping_marks}` : '',
  ].filter(Boolean).join('\n');

  doc.setTextColor(0);

  const drawBoxContent = (
    box: TemplateBox | null | undefined,
    textValue: string,
    fallbackFontSize: number,
    options: { align?: PdfTextAlign; bold?: boolean; maxLines?: number } = {},
  ) => {
    const normalizedText = normalizePdfText(textValue);
    const normalizedBox = normalizeTemplateBox(box);
    if (!normalizedText || !normalizedBox) return;

    const boxWidthMm = normalizedBox.w * pageWidth;
    const boxHeightMm = normalizedBox.h * pageHeight;
    const paddingX = Math.min(Math.max(boxWidthMm * 0.025, 0.7), 1.8);
    const paddingY = Math.min(Math.max(boxHeightMm * 0.08, 0.45), 1.4);
    const contentWidthMm = Math.max(1, boxWidthMm - paddingX * 2);
    const contentHeightMm = Math.max(1, boxHeightMm - paddingY * 2);
    const align = options.align ?? normalizedBox.align ?? 'left';
    const bold = options.bold ?? normalizedBox.bold ?? false;
    const requestedFontSize = Math.max(6, (normalizedBox.font_size ?? fallbackFontSize) * fontScale);
    const hardCapLines = normalizedBox.max_lines ?? options.maxLines;

    // Auto-shrink: use inner padding + ellipsis fallback so text never bleeds into adjacent cells.
    const MIN_FONT = 5.5;
    let chosenFontSize = requestedFontSize;
    let chosenLineHeight = chosenFontSize * 0.38 + 0.55;
    let chosenLines: string[] = [];

    for (let fs = requestedFontSize; fs >= MIN_FONT; fs -= 0.5) {
      doc.setFont(PDF_FONT_FAMILY, bold ? 'bold' : 'normal');
      doc.setFontSize(fs);
      const lh = fs * 0.38 + 0.55;
      const fitLinesByHeight = Math.max(1, Math.floor(contentHeightMm / lh));
      const lineCap = Math.min(
        typeof hardCapLines === 'number' ? hardCapLines : Infinity,
        fitLinesByHeight,
      );
      const wrapped = wrapPdfText(doc, normalizedText, contentWidthMm);
      if (wrapped.length <= lineCap || fs - 0.5 < MIN_FONT) {
        chosenFontSize = fs;
        chosenLineHeight = lh;
        chosenLines = clampPdfLines(doc, wrapped, lineCap, contentWidthMm);
        break;
      }
    }

    const usedHeight = chosenLines.length * chosenLineHeight;
    const topPad = Math.max(0, (contentHeightMm - usedHeight) / 2);
    const startX = normalizedBox.x * pageWidth + paddingX;
    const startY = normalizedBox.y * pageHeight + paddingY;
    const baselineY = startY + topPad + chosenFontSize * 0.32 + 0.35;

    doc.setFont(PDF_FONT_FAMILY, bold ? 'bold' : 'normal');
    doc.setFontSize(chosenFontSize);
    chosenLines.forEach((line, index) => {
      const lineX =
        align === 'left'
          ? startX
          : align === 'center'
            ? startX + contentWidthMm / 2
            : startX + contentWidthMm;
      doc.text(line, lineX, baselineY + index * chosenLineHeight, { align });
    });
  };

  const addTemplateRegion = (key: 'logo' | 'stamp') => {
    if (!templateCanvas) return;

    const box = imageRegionMap.get(key);
    if (!box) return;

    const dataUrl = extractRegionFromCanvas(templateCanvas, box);
    if (!dataUrl) return;

    doc.addImage(
      dataUrl,
      'PNG',
      box.x * pageWidth,
      box.y * pageHeight,
      box.w * pageWidth,
      box.h * pageHeight,
    );
  };

  const drawField = (
    key: TemplateFieldKey,
    value: string,
    fallbackLabel: string,
    fallbackFontSize: number,
    options: { valueBold?: boolean; labelBold?: boolean; valueAlign?: PdfTextAlign; maxLines?: number } = {},
  ) => {
    const field = fieldMap.get(key);
    if (!field) return;

    const labelText = normalizePdfText(field.label || fallbackLabel);
    if (field.label_box && labelText) {
      drawBoxContent(field.label_box, labelText, 8, { bold: options.labelBold ?? true, maxLines: 2 });
    }

    if (field.value_box && value) {
      drawBoxContent(field.value_box, value, fallbackFontSize, {
        bold: options.valueBold ?? false,
        align: options.valueAlign,
        maxLines: options.maxLines,
      });
    }
  };

  addTemplateRegion('logo');
  addTemplateRegion('stamp');

  (resolvedLayout.static_texts ?? []).forEach((item) => {
    drawBoxContent(item.box, item.text, item.box.font_size ?? 9, {
      bold: item.box.bold ?? false,
      align: item.box.align ?? 'left',
      maxLines: item.box.max_lines ?? 3,
    });
  });

  const titleAlreadyRendered = (resolvedLayout.static_texts ?? []).some((item) => (
    item.text.trim().toLowerCase() === normalizePdfText(resolvedLayout.title || '').toLowerCase()
  ));

  if (!titleAlreadyRendered && resolvedLayout.title) {
    drawBoxContent(
      createNormalizedBox(45, 10, 120, 12, { align: 'center', font_size: 16, max_lines: 2, bold: true }),
      resolvedLayout.title,
      16,
      { align: 'center', bold: true, maxLines: 2 },
    );
  }

  drawField('invoice_number', invNum, 'Invoice No.', 9);
  drawField('date', date, 'Date', 9);
  drawField('shipper', shipperBlock, 'SHIPPER', 8.5, { maxLines: 7 });
  drawField('notify_party', notifyBlock, 'NOTIFY PARTY', 8.5, { maxLines: 7 });
  drawField('consignee', consigneeBlock, 'CONSIGNEE', 8.5, { maxLines: 7 });
  drawField('container_info', [containerSize, containerNums].filter(Boolean).join('\n'), 'CONTAINER / SIZE', 9, { maxLines: 5 });
  drawField('vessel', blData?.vessel_name || '', 'VESSEL / FLIGHT', 9, { maxLines: 2 });
  drawField('hs_code', blData?.hs_code || '', 'HS CODE', 9, { maxLines: 2 });
  drawField('port_of_loading', blData?.port_of_loading || '', 'PORT OF LOADING', 9, { maxLines: 3 });
  drawField('port_of_discharge', blData?.port_of_discharge || '', 'PORT OF DISCHARGE / DESTINATION', 9, { maxLines: 3 });
  drawField('goods_description', blData?.description || '', 'GOODS DESCRIPTION', 8.5, {
    maxLines: resolvedLayout.has_shipping_marks === false ? 8 : 5,
  });

  if (resolvedLayout.has_shipping_marks !== false || blData?.shipping_marks) {
    drawField('shipping_marks', blData?.shipping_marks || '', 'SHIPPING MARKS', 8.5, { maxLines: 3 });
  }

  drawField(
    'packages',
    bales ? `${bales} BALES` : blData?.packages || '',
    resolvedLayout.has_bales_packages === false ? 'PACKAGES' : 'NO. & KIND OF PKGS',
    10,
    { valueBold: true, valueAlign: 'center', maxLines: 2 },
  );
  drawField(
    'gross_weight',
    `${calc.kgs.toFixed(4)} KGS`,
    resolvedLayout.has_weight_pricing === false ? 'WEIGHT' : 'G.WEIGHT',
    9.5,
    { valueAlign: 'right' },
  );
  drawField('unit_price', `${calc.unitPriceText} US$ PER KG`, 'UNIT PRICE', 9.5, { valueAlign: 'right' });
  drawField('amount', `${calc.totalPriceDisplay} US$`, 'AMOUNT', 11, { valueBold: true, valueAlign: 'right' });
  drawField('reference', referenceBlock, 'REFERENCE', 8.5, { maxLines: 5 });
  drawField('company_name', blData?.shipper || 'COMPANY NAME', '', 10, { valueBold: true, valueAlign: 'center', maxLines: 1 });

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
      const containerNums = blData?.container_numbers?.join(', ') || '';
      const firstContainer = blData?.container_numbers?.[0] || '';
      const containerSize = blData?.container_size || '';
      const bales = balesCount || blData?.bales || '';

      // Adobe Document Generation merge tags
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

      // Determine route: user PDF template -> overlay; user DOCX -> Adobe with their template; else built-in Adobe
      const tplName = (templateFile?.name || '').toLowerCase();
      const isUserPdf = templateFile && (templateFile.type === 'application/pdf' || tplName.endsWith('.pdf'));
      const isUserDocx = templateFile && (
        tplName.endsWith('.docx') || tplName.endsWith('.doc') ||
        templateFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );

      let pdfBase64: string | undefined;

      if (isUserPdf) {
        // Overlay text on user's PDF (stamp + lines + spacing preserved)
        // Combine name + address into single block for layout fields that hold both
        const overlayData = {
          ...adobeData,
          shipper: [blData?.shipper, blData?.shipper_address].filter(Boolean).join('\n'),
          consignee: [blData?.consignee, blData?.consignee_address].filter(Boolean).join('\n'),
          notify_party: [
            blData?.notify_party || blData?.consignee,
            blData?.notify_party_address || blData?.consignee_address,
          ].filter(Boolean).join('\n'),
        };
        const templateBase64 = await readFileAsBase64(templateFile!);
        const resolved = resolveTemplateLayout(templateLayout);
        const { data, error } = await supabase.functions.invoke('generate-invoice-overlay', {
          body: { templateBase64, data: overlayData, fields: resolved.fields ?? [] },
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'PDF overlay failed');
        pdfBase64 = data.pdfBase64;
      } else {
        // Adobe Document Generation (DOCX template — user's or built-in)
        const templateBase64 = isUserDocx ? await readFileAsBase64(templateFile!) : undefined;
        const { data, error } = await supabase.functions.invoke('generate-invoice-adobe', {
          body: { data: adobeData, templateBase64 },
        });
        if (error) throw error;
        if (!data?.success || !data?.pdfBase64) throw new Error(data?.error || 'Adobe generation failed');
        pdfBase64 = data.pdfBase64;
      }

      const bin = atob(pdfBase64!);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Invoice-${invNum}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStep(3);
      toast.success('Invoice generated via Adobe!');
    } catch (err: any) {
      console.error('Invoice generation error:', err);
      toast.error(`Failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  };

  const removeSavedTemplate = async () => {
    try {
      if (templateStorageKey) {
        await removePersistedInvoiceTemplate(templateStorageKey);
      }
      setTemplateFile(null);
      setTemplateLayout(null);
      if (templateInputRef.current) templateInputRef.current.value = '';
      toast.success('Saved template removed.');
    } catch (error) {
      console.error('Failed to remove saved template:', error);
      toast.error('Template remove nahi hua. Dobara try karein.');
    }
  };

  const resetAll = () => {
    setBlFile(null);
    setCompanyPrice('');
    setInvoiceNumber('');
    setBalesCount('');
    setBlData(null);
    setStep(1);
    setInvoiceDate(todayDDMMYY());
    setMatchedRow(null);
  };

  const tryAutoFillFromExcel = (containerNumbers: string[]) => {
    if (!excelRows.length || !containerNumbers || containerNumbers.length === 0) return;
    const keys = containerNumbers.map(normalizeContainerKey).filter(Boolean);
    const found = excelRows.find((row) => keys.includes(normalizeContainerKey(row.container)));
    if (found) {
      setMatchedRow(found);
      if (found.invoice) setInvoiceNumber(found.invoice);
      if (found.price) setCompanyPrice(found.price);
      toast.success(`Matched container ${found.container} from Excel.`);
    } else {
      setMatchedRow(null);
      toast.error('No matching container found in Excel.');
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    const name = file.name.toLowerCase();
    const isCsv = name.endsWith('.csv');
    const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls');
    if (!isCsv && !isXlsx) {
      toast.error('Please upload .xlsx, .xls or .csv file.');
      return;
    }
    setExcelLoading(true);
    try {
      let rows: string[][] = [];
      if (isCsv) {
        const text = await file.text();
        rows = text.split(/\r?\n/).filter((l) => l.trim().length > 0).map((line) => {
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
              const v = cell.value;
              if (v === null || v === undefined) { arr.push(''); return; }
              if (typeof v === 'object' && v !== null) {
                if ('text' in v && typeof (v as any).text === 'string') { arr.push((v as any).text); return; }
                if ('richText' in v && Array.isArray((v as any).richText)) {
                  arr.push(((v as any).richText as { text: string }[]).map((r) => r.text).join(''));
                  return;
                }
                if ('result' in v) { arr.push(String((v as any).result ?? '')); return; }
              }
              arr.push(String(v));
            });
            rows.push(arr.map((c) => (c ?? '').toString().trim()));
          });
        }
      }
      if (rows.length === 0) {
        toast.error('Excel file is empty.');
        return;
      }

      // Detect header row
      const header = rows[0].map((h) => h.toLowerCase());
      const findCol = (keywords: string[]) =>
        header.findIndex((h) => keywords.some((k) => h.includes(k)));
      let containerCol = findCol(['container']);
      let invoiceCol = findCol(['invoice']);
      let priceCol = findCol(['company price', 'total amount', 'total price', 'amount', 'price']);
      let dataStart = 1;
      if (containerCol === -1 && invoiceCol === -1 && priceCol === -1) {
        // No header — assume first 3 columns
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
      if (parsed.length === 0) {
        toast.error('No data rows found in Excel.');
        return;
      }
      setExcelRows(parsed);
      setExcelFileName(file.name);
      toast.success('Excel data loaded successfully.');

      // If BL already extracted, try matching now
      if (blData?.container_numbers?.length) {
        const keys = blData.container_numbers.map(normalizeContainerKey).filter(Boolean);
        const found = parsed.find((row) => keys.includes(normalizeContainerKey(row.container)));
        if (found) {
          setMatchedRow(found);
          if (found.invoice) setInvoiceNumber(found.invoice);
          if (found.price) setCompanyPrice(found.price);
        }
      }
    } catch (err: any) {
      console.error('Excel upload error:', err);
      toast.error('Failed to read Excel: ' + (err?.message || 'Unknown error'));
    } finally {
      setExcelLoading(false);
    }
  };

  const clearExcel = () => {
    setExcelRows([]);
    setExcelFileName(null);
    setMatchedRow(null);
  };


  const calc = calculateValues();

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
            Upload your BL, let AI map the original template, and generate a line-free invoice that follows the same layout.
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
          <motion.div layout className="lg:col-span-2 space-y-6">
            {/* Excel Auto-Fill Upload */}
            <Card className="border-border/50 shadow-sm overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-emerald-500/5 to-transparent">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                  Excel Auto-Fill (Optional)
                </CardTitle>
                <CardDescription>
                  Upload an Excel/CSV with Container Number, Invoice Number, and Company Price. Matching rows will auto-fill after BL extraction.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleExcelUpload}
                  className="hidden"
                />
                <div
                  onClick={() => !excelLoading && excelInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all"
                >
                  {excelLoading ? (
                    <div className="flex items-center justify-center gap-2 text-emerald-600">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm font-medium">Reading Excel...</span>
                    </div>
                  ) : excelFileName ? (
                    <div className="flex items-center justify-center gap-3">
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                      <div className="text-left">
                        <p className="font-medium text-foreground">{excelFileName}</p>
                        <p className="text-xs text-muted-foreground">{excelRows.length} rows loaded</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); clearExcel(); }}
                        className="ml-2"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                      <p className="font-medium text-foreground">Click to upload Excel/CSV</p>
                      <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .csv</p>
                    </>
                  )}
                </div>

                <AnimatePresence>
                  {matchedRow && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-xl p-4 border bg-emerald-500/5 border-emerald-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          <span className="font-semibold text-foreground">Matched Record</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                          <div><span className="text-muted-foreground">Container:</span> <span className="font-medium text-foreground">{matchedRow.container}</span></div>
                          <div><span className="text-muted-foreground">Invoice #:</span> <span className="font-medium text-foreground">{matchedRow.invoice || '—'}</span></div>
                          <div><span className="text-muted-foreground">Company Price:</span> <span className="font-medium text-foreground">{matchedRow.price || '—'}</span></div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>

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
                            type="text"
                            inputMode="decimal"
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

                      {/* Editable BL fields — full PDF editor */}
                      {blData && (
                        <div className="space-y-3 rounded-xl border border-border/50 bg-muted/30 p-4">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-primary" />
                            <h4 className="text-sm font-semibold text-foreground">Edit Invoice Fields</h4>
                            <span className="text-xs text-muted-foreground">— ye sab fields PDF me same dikhayenge</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Shipper</Label>
                              <Input value={blData.shipper ?? ''} onChange={(e) => setBlData({ ...blData, shipper: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Shipper Address</Label>
                              <Input value={blData.shipper_address ?? ''} onChange={(e) => setBlData({ ...blData, shipper_address: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Consignee</Label>
                              <Input value={blData.consignee ?? ''} onChange={(e) => setBlData({ ...blData, consignee: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Consignee Address</Label>
                              <Input value={blData.consignee_address ?? ''} onChange={(e) => setBlData({ ...blData, consignee_address: e.target.value })} />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <Label className="text-xs">Notify Party (Name & Address)</Label>
                              <Input
                                value={blData.notify_party ?? ''}
                                onChange={(e) => setBlData({ ...blData, notify_party: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Port of Loading</Label>
                              <Input value={blData.port_of_loading ?? ''} onChange={(e) => setBlData({ ...blData, port_of_loading: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Port of Discharge</Label>
                              <Input value={blData.port_of_discharge ?? ''} onChange={(e) => setBlData({ ...blData, port_of_discharge: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Vessel / Flight</Label>
                              <Input value={blData.vessel_name ?? ''} onChange={(e) => setBlData({ ...blData, vessel_name: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">HS Code</Label>
                              <Input value={blData.hs_code ?? ''} onChange={(e) => setBlData({ ...blData, hs_code: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">BL Number</Label>
                              <Input value={blData.bl_number ?? ''} onChange={(e) => setBlData({ ...blData, bl_number: e.target.value })} />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <Label className="text-xs">Container Numbers (comma separated)</Label>
                              <Input
                                value={blData.container_numbers?.join(', ') ?? ''}
                                onChange={(e) => setBlData({ ...blData, container_numbers: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                              />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <Label className="text-xs">Goods Description</Label>
                              <Input value={blData.description ?? ''} onChange={(e) => setBlData({ ...blData, description: e.target.value })} />
                            </div>
                            <div className="space-y-1 sm:col-span-2">
                              <Label className="text-xs">Shipping Marks</Label>
                              <Input value={blData.shipping_marks ?? ''} onChange={(e) => setBlData({ ...blData, shipping_marks: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Weight (KGS)</Label>
                              <Input
                                type="number"
                                value={blData.kgs ?? ''}
                                onChange={(e) => setBlData({ ...blData, kgs: e.target.value ? parseFloat(e.target.value) : null })}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Packages Text</Label>
                              <Input value={blData.packages ?? ''} onChange={(e) => setBlData({ ...blData, packages: e.target.value })} />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Template upload */}
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <FileUp className="w-4 h-4 text-primary" />
                            Original Invoice Template (AI Exact Match)
                        </Label>
                         <input ref={templateInputRef} type="file" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp" onChange={handleTemplateUpload} className="hidden" />
                        <div
                          onClick={() => !templateFile && templateInputRef.current?.click()}
                          className="border border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all text-sm"
                        >
                          {extractingTemplate ? (
                            <div className="flex items-center justify-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                              <span className="text-muted-foreground">Analyzing template layout...</span>
                            </div>
                          ) : templateFile ? (
                            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                              <div className="flex items-center justify-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                                <span className="text-foreground">{templateFile.name}</span>
                                 <span className="text-xs text-green-600">(AI exact-match mode)</span>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void removeSavedTemplate();
                                }}
                              >
                                <RotateCcw className="w-4 h-4" />
                                Remove template
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">
                               Upload PDF ya Word (.docx) template — PDF me text overlay hoga, DOCX me Adobe merge tags
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
                              <p className="text-lg font-bold text-primary">${calc.unitPriceText}/KG</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Total</p>
                              <p className="text-lg font-bold text-foreground">${calc.totalPriceDisplay}</p>
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
                  { icon: Download, title: 'AI Exact Invoice', desc: 'AI places fields on the same template layout without adding generic lines' },
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
