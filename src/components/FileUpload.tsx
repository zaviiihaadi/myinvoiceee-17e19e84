import { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FileUploadProps {
  onFileProcessed: (containerNumbers: string[]) => void;
  isProcessing: boolean;
}

export function FileUpload({ onFileProcessed, isProcessing }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);

  // File processing limits to prevent DoS
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const MAX_ROWS = 5000;
  const MAX_CONTAINERS = 2000;

  // Helper function to extract string value from Excel cell
  const getCellStringValue = (cellValue: unknown): string | null => {
    if (cellValue === null || cellValue === undefined) return null;
    
    // Handle string values directly
    if (typeof cellValue === 'string') {
      return cellValue;
    }
    
    // Handle number values (container numbers might be stored as numbers)
    if (typeof cellValue === 'number') {
      return String(cellValue);
    }
    
    // Handle rich text objects (ExcelJS returns these for formatted cells)
    if (typeof cellValue === 'object' && cellValue !== null) {
      // Check for richText property
      if ('richText' in cellValue && Array.isArray((cellValue as { richText: unknown[] }).richText)) {
        const richText = (cellValue as { richText: { text: string }[] }).richText;
        return richText.map(rt => rt.text).join('');
      }
      // Check for text property
      if ('text' in cellValue && typeof (cellValue as { text: unknown }).text === 'string') {
        return (cellValue as { text: string }).text;
      }
      // Check for result property (formulas)
      if ('result' in cellValue) {
        const result = (cellValue as { result: unknown }).result;
        if (typeof result === 'string') return result;
        if (typeof result === 'number') return String(result);
      }
      // Try toString as last resort
      try {
        const str = String(cellValue);
        if (str !== '[object Object]') return str;
      } catch {
        // Ignore
      }
    }
    
    return null;
  };

  // Helper to clean and validate container number
  const cleanContainerNumber = (value: string): string | null => {
    // Remove common prefixes, spaces, special chars
    const cleaned = value
      .trim()
      .toUpperCase()
      .replace(/[\s\-_\.,:;#'"]/g, '') // Remove common separators
      .replace(/^(CONT|CONTAINER|CNT|CTR|NO|NUM|#|:)+/i, ''); // Remove common prefixes
    
    // Standard ISO container format: 4 letters + 7 digits
    if (/^[A-Z]{4}\d{7}$/.test(cleaned)) {
      return cleaned;
    }
    
    // Flexible format: 3-4 letters + 6-7 digits
    if (/^[A-Z]{3,4}\d{6,7}$/.test(cleaned)) {
      return cleaned;
    }
    
    // Try to extract container number from longer string
    const match = cleaned.match(/([A-Z]{3,4}\d{6,7})/);
    if (match) {
      return match[1];
    }
    
    return null;
  };

  // Check if a header value matches container column names
  const isContainerColumnHeader = (value: string): boolean => {
    const normalized = value.toLowerCase().trim();
    const containerColumnNames = [
      'container', 'container no', 'container number', 'container_number',
      'container#', 'containerno', 'containernumber', 'cont', 'cont no',
      'cont number', 'cnt', 'cnt no', 'ctr', 'ctr no', 'container id',
      'containerid', 'box', 'box no', 'box number', 'unit', 'unit no',
      'unit number', 'equipment', 'equipment no', 'equipment number'
    ];
    return containerColumnNames.some(name => normalized === name || normalized.includes(name));
  };

  const processExcelFile = useCallback(async (file: File) => {
    // Validate file size before processing
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
      return;
    }

    setIsReading(true);
    setError(null);
    
    try {
      const ExcelJS = await import('exceljs');
      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      
      const containerNumbers: string[] = [];
      let totalRowsProcessed = 0;
      
      for (const worksheet of workbook.worksheets) {
        if (!worksheet || totalRowsProcessed >= MAX_ROWS) break;
        
        // Find the container column by looking at header row(s)
        let containerColumnIndex: number | null = null;
        let headerRowIndex = 0;
        
        // Check first 5 rows for header
        for (let rowNum = 1; rowNum <= Math.min(5, worksheet.rowCount); rowNum++) {
          const row = worksheet.getRow(rowNum);
          row.eachCell((cell, colNumber) => {
            if (containerColumnIndex !== null) return;
            
            const cellValue = getCellStringValue(cell.value);
            if (cellValue && isContainerColumnHeader(cellValue)) {
              containerColumnIndex = colNumber;
              headerRowIndex = rowNum;
              console.log(`Found container column "${cellValue}" at column ${colNumber}, row ${rowNum}`);
            }
          });
          if (containerColumnIndex !== null) break;
        }
        
        // If we found a container column, extract only from that column
        if (containerColumnIndex !== null) {
          worksheet.eachRow((row, rowNumber) => {
            // Skip header row and rows before it
            if (rowNumber <= headerRowIndex) return;
            if (totalRowsProcessed >= MAX_ROWS || containerNumbers.length >= MAX_CONTAINERS) return;
            totalRowsProcessed++;
            
            const cell = row.getCell(containerColumnIndex!);
            const stringValue = getCellStringValue(cell.value);
            if (!stringValue) return;
            
            const containerNumber = cleanContainerNumber(stringValue);
            if (containerNumber && !containerNumbers.includes(containerNumber)) {
              containerNumbers.push(containerNumber);
            }
          });
        } else {
          // Fallback: scan all cells if no container column header found
          console.log('No container column header found, scanning all cells...');
          worksheet.eachRow((row, rowNumber) => {
            if (totalRowsProcessed >= MAX_ROWS || containerNumbers.length >= MAX_CONTAINERS) return;
            totalRowsProcessed++;
            
            row.eachCell((cell) => {
              if (containerNumbers.length >= MAX_CONTAINERS) return;
              
              const stringValue = getCellStringValue(cell.value);
              if (!stringValue) return;
              
              const containerNumber = cleanContainerNumber(stringValue);
              if (containerNumber && !containerNumbers.includes(containerNumber)) {
                containerNumbers.push(containerNumber);
              }
            });
          });
        }
      }
      
      if (containerNumbers.length === 0) {
        setError('No valid container numbers found. Make sure your Excel has a "Container" column with values like MSCU1234567.');
        return;
      }
      
      const uniqueNumbers = [...new Set(containerNumbers)];
      
      if (uniqueNumbers.length > MAX_CONTAINERS) {
        setError(`Too many containers found (${uniqueNumbers.length}). Maximum is ${MAX_CONTAINERS} containers per file.`);
        return;
      }
      
      console.log(`Found ${uniqueNumbers.length} container numbers in file`);
      onFileProcessed(uniqueNumbers);
    } catch (err) {
      setError('Failed to read the Excel file. Please ensure it\'s a valid .xlsx or .xls file.');
      console.error('File processing error');
    } finally {
      setIsReading(false);
    }
  }, [onFileProcessed]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      setFile(droppedFile);
      processExcelFile(droppedFile);
    } else {
      setError('Please upload an Excel file (.xlsx or .xls)');
    }
  }, [processExcelFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      processExcelFile(selectedFile);
    }
  }, [processExcelFile]);

  const clearFile = useCallback(() => {
    setFile(null);
    setError(null);
  }, []);

  return (
    <div className="w-full">
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          'relative border-2 border-dashed rounded-xl p-8 transition-all duration-300 cursor-pointer group',
          isDragging 
            ? 'border-primary bg-primary/5 scale-[1.02]' 
            : 'border-border hover:border-primary/50 hover:bg-muted/50',
          (isProcessing || isReading) && 'pointer-events-none opacity-70'
        )}
      >
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isProcessing || isReading}
        />
        
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          {file ? (
            <>
              <div className="w-16 h-16 rounded-xl bg-status-arrived/10 flex items-center justify-center">
                <FileSpreadsheet className="w-8 h-8 text-status-arrived" />
              </div>
              <div>
                <p className="font-medium text-foreground flex items-center gap-2 justify-center">
                  <CheckCircle2 className="w-4 h-4 text-status-arrived" />
                  {file.name}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              {!isProcessing && !isReading && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFile();
                  }}
                  className="gap-2"
                >
                  <X className="w-4 h-4" />
                  Remove
                </Button>
              )}
            </>
          ) : (
            <>
              <div className={cn(
                'w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center transition-transform duration-300',
                'group-hover:scale-110'
              )}>
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  Drop your Excel file here
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to browse (.xlsx, .xls)
                </p>
              </div>
              <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>File should contain container numbers (e.g., MSCU1234567)</span>
                </div>
                <span>Maximum file size: 10MB, up to 2,000 containers</span>
              </div>
            </>
          )}
          
          {(isReading || isProcessing) && (
            <div className="flex items-center gap-2 text-primary">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">{isReading ? 'Reading file...' : 'Processing...'}</span>
            </div>
          )}
        </div>
      </div>
      
      {error && (
        <div className="mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}
