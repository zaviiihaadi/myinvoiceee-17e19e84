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
import {
  FileText, Upload, Calculator, Download, Loader2, CheckCircle2,
  AlertCircle, Package, Scale, DollarSign, Hash, Calendar, ArrowRight,
  Sparkles, Ship, FileUp, Eye
} from 'lucide-react';

interface BLData {
  kgs: number | null;
  shipper: string | null;
  consignee: string | null;
  port_of_loading: string | null;
  port_of_discharge: string | null;
  description: string | null;
  packages: string | null;
  container_numbers: string[];
  bl_number: string | null;
  raw_weight_text: string | null;
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
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [blData, setBlData] = useState<BLData | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

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

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTemplateFile(file);
  };

  const extractBLData = async () => {
    if (!blFile) return;
    setExtracting(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blFile);
      });

      const { data, error } = await supabase.functions.invoke('extract-bl-data', {
        body: { fileBase64: base64, mimeType: blFile.type },
      });

      if (error) throw error;

      if (data.kgs) {
        setBlData(data);
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
    const unitPrice = Math.round((price / blData.kgs) * 100) / 100;
    const totalPrice = Math.round(unitPrice * blData.kgs * 100) / 100;
    return { unitPrice, totalPrice, kgs: blData.kgs };
  };

  const generateInvoice = async () => {
    const calc = calculateValues();
    if (!calc) {
      toast.error('Please fill all required fields');
      return;
    }
    setGenerating(true);
    try {
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const invNum = invoiceNumber || `INV-${Date.now()}`;

      // If user uploaded a template, read it and replace placeholders
      let templateContent: string | null = null;
      if (templateFile) {
        const text = await templateFile.text();
        templateContent = text
          .replace(/\{invoice_number\}/g, invNum)
          .replace(/\{kgs\}/g, String(calc.kgs))
          .replace(/\{unit_price\}/g, String(calc.unitPrice))
          .replace(/\{total_price\}/g, String(calc.totalPrice))
          .replace(/\{date\}/g, today)
          .replace(/\{shipper\}/g, blData?.shipper || 'N/A')
          .replace(/\{consignee\}/g, blData?.consignee || 'N/A')
          .replace(/\{port_of_loading\}/g, blData?.port_of_loading || 'N/A')
          .replace(/\{port_of_discharge\}/g, blData?.port_of_discharge || 'N/A')
          .replace(/\{description\}/g, blData?.description || 'N/A')
          .replace(/\{bl_number\}/g, blData?.bl_number || 'N/A')
          .replace(/\{packages\}/g, blData?.packages || 'N/A');
      }

      // Generate PDF
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();

      if (templateContent) {
        // Simple text-based template rendering
        const lines = templateContent.split('\n');
        let y = 20;
        lines.forEach(line => {
          if (y > 270) { doc.addPage(); y = 20; }
          doc.setFontSize(11);
          doc.text(line, 14, y);
          y += 7;
        });
      } else {
        // Default professional invoice template
        // Header gradient bar
        doc.setFillColor(29, 119, 209);
        doc.rect(0, 0, pageWidth, 40, 'F');
        doc.setFillColor(15, 85, 170);
        doc.rect(0, 35, pageWidth, 5, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(28);
        doc.setFont('helvetica', 'bold');
        doc.text('INVOICE', 14, 25);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`#${invNum}`, 14, 33);
        doc.text(today, pageWidth - 14, 25, { align: 'right' });

        // Reset text color
        doc.setTextColor(30, 30, 30);
        let y = 55;

        // Shipper / Consignee info
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text('FROM', 14, y);
        doc.text('TO', pageWidth / 2 + 5, y);
        y += 6;
        doc.setTextColor(30, 30, 30);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(blData?.shipper || 'N/A', 14, y);
        doc.text(blData?.consignee || 'N/A', pageWidth / 2 + 5, y);
        y += 14;

        // Shipment details
        doc.setFillColor(245, 247, 250);
        doc.roundedRect(14, y - 4, pageWidth - 28, 30, 3, 3, 'F');
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        const cols = [
          { label: 'Port of Loading', value: blData?.port_of_loading || 'N/A' },
          { label: 'Port of Discharge', value: blData?.port_of_discharge || 'N/A' },
          { label: 'BL Number', value: blData?.bl_number || 'N/A' },
        ];
        const colW = (pageWidth - 28) / 3;
        cols.forEach((col, i) => {
          const x = 14 + i * colW + 6;
          doc.text(col.label, x, y + 5);
          doc.setTextColor(30, 30, 30);
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.text(col.value, x, y + 14);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(120, 120, 120);
        });
        y += 38;

        // Description
        if (blData?.description) {
          doc.setTextColor(120, 120, 120);
          doc.setFontSize(9);
          doc.text('DESCRIPTION OF GOODS', 14, y);
          y += 6;
          doc.setTextColor(30, 30, 30);
          doc.setFontSize(10);
          const descLines = doc.splitTextToSize(blData.description, pageWidth - 28);
          doc.text(descLines, 14, y);
          y += descLines.length * 5 + 10;
        }

        // Table header
        doc.setFillColor(29, 119, 209);
        doc.rect(14, y, pageWidth - 28, 10, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('ITEM', 20, y + 7);
        doc.text('WEIGHT (KGS)', 80, y + 7);
        doc.text('UNIT PRICE', 125, y + 7);
        doc.text('TOTAL', pageWidth - 20, y + 7, { align: 'right' });
        y += 14;

        // Table row
        doc.setTextColor(30, 30, 30);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(blData?.description?.substring(0, 35) || 'Cargo', 20, y + 5);
        doc.text(String(calc.kgs), 80, y + 5);
        doc.text(`$${calc.unitPrice.toFixed(2)}`, 125, y + 5);
        doc.text(`$${calc.totalPrice.toFixed(2)}`, pageWidth - 20, y + 5, { align: 'right' });

        // Row line
        doc.setDrawColor(230, 230, 230);
        doc.line(14, y + 10, pageWidth - 14, y + 10);
        y += 20;

        // Totals box
        const totalsX = pageWidth - 90;
        doc.setFillColor(245, 247, 250);
        doc.roundedRect(totalsX - 6, y, 82, 35, 3, 3, 'F');
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text('Subtotal', totalsX, y + 10);
        doc.text('Tax (0%)', totalsX, y + 20);
        doc.setTextColor(30, 30, 30);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('TOTAL', totalsX, y + 30);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text(`$${calc.totalPrice.toFixed(2)}`, pageWidth - 20, y + 10, { align: 'right' });
        doc.text('$0.00', pageWidth - 20, y + 20, { align: 'right' });
        doc.setTextColor(29, 119, 209);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(`$${calc.totalPrice.toFixed(2)}`, pageWidth - 20, y + 30, { align: 'right' });

        // Footer
        const footerY = doc.internal.pageSize.getHeight() - 20;
        doc.setDrawColor(230, 230, 230);
        doc.line(14, footerY - 5, pageWidth - 14, footerY - 5);
        doc.setFontSize(8);
        doc.setTextColor(160, 160, 160);
        doc.setFont('helvetica', 'normal');
        doc.text('Generated by ShipAhead Invoice Generator', 14, footerY);
        doc.text(today, pageWidth - 14, footerY, { align: 'right' });
      }

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
    setBlData(null);
    setStep(1);
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
            Upload your BL, extract weight automatically, and generate professional invoices in seconds.
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
                      Extracting KGS with AI...
                    </>
                  ) : (
                    <>
                      <Scale className="w-4 h-4" />
                      Extract Weight (KGS)
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
                            {blData.kgs ? `Weight Found: ${blData.kgs} KGS` : 'Weight not detected'}
                          </span>
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
                            {blData.description && (
                              <div className="col-span-2"><span className="text-muted-foreground">Goods:</span> <span className="text-foreground">{blData.description}</span></div>
                            )}
                          </div>
                        )}
                        {blData.raw_weight_text && (
                          <p className="text-xs text-muted-foreground mt-2 italic">Source: "{blData.raw_weight_text}"</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>

            {/* Step 2: Details & Template */}
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
                        <Calculator className="w-5 h-5 text-accent" />
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
                            placeholder="e.g. 50000"
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
                            placeholder="e.g. INV-2026-001"
                            value={invoiceNumber}
                            onChange={(e) => setInvoiceNumber(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">Leave empty to auto-generate</p>
                        </div>
                      </div>

                      {/* Template upload (optional) */}
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <FileUp className="w-4 h-4 text-primary" />
                          Invoice Template (Optional)
                        </Label>
                        <input ref={templateInputRef} type="file" accept=".txt,.html" onChange={handleTemplateUpload} className="hidden" />
                        <div
                          onClick={() => templateInputRef.current?.click()}
                          className="border border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all text-sm"
                        >
                          {templateFile ? (
                            <div className="flex items-center justify-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                              <span className="text-foreground">{templateFile.name}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">
                              Upload .txt or .html template with placeholders like {'{kgs}'}, {'{unit_price}'}, {'{total_price}'}
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
                          <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                              <p className="text-xs text-muted-foreground">Weight</p>
                              <p className="text-lg font-bold text-foreground">{calc.kgs} KG</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Unit Price</p>
                              <p className="text-lg font-bold text-primary">${calc.unitPrice.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Total Price</p>
                              <p className="text-lg font-bold text-accent">${calc.totalPrice.toFixed(2)}</p>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      <Button
                        onClick={generateInvoice}
                        disabled={!calc || generating}
                        className="w-full gap-2 bg-gradient-to-r from-primary to-primary/80 hover:opacity-90"
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
                      <p className="text-sm text-muted-foreground mb-4">Your PDF has been downloaded.</p>
                      <Button variant="outline" onClick={resetAll} className="gap-2">
                        <FileText className="w-4 h-4" />
                        Generate Another Invoice
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Sidebar - How it works */}
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
                  { icon: Sparkles, title: 'AI Extracts KGS', desc: 'AI reads your BL and extracts the weight' },
                  { icon: Calculator, title: 'Enter Price', desc: 'Enter your company total price' },
                  { icon: Download, title: 'Get Invoice', desc: 'Download professional PDF invoice' },
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
                    {['{invoice_number}', '{kgs}', '{unit_price}', '{total_price}', '{date}', '{shipper}', '{consignee}', '{bl_number}'].map(p => (
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
