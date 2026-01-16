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
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const MAX_ROWS = 1000;
  const MAX_CONTAINERS = 500;

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
      
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        setError('No worksheet found in the Excel file.');
        return;
      }

      // Validate row count
      if (worksheet.rowCount > MAX_ROWS) {
        setError(`File has too many rows. Maximum is ${MAX_ROWS} rows.`);
        return;
      }
      
      // Extract container numbers (look for patterns like XXXX1234567)
      const containerPattern = /^[A-Z]{4}\d{7}$/;
      const containerNumbers: string[] = [];
      let rowsProcessed = 0;
      
      worksheet.eachRow((row) => {
        if (rowsProcessed >= MAX_ROWS || containerNumbers.length >= MAX_CONTAINERS) return;
        rowsProcessed++;
        
        row.eachCell((cell) => {
          if (containerNumbers.length >= MAX_CONTAINERS) return;
          
          const value = cell.value;
          if (typeof value === 'string') {
            const cleaned = value.trim().toUpperCase();
            if (containerPattern.test(cleaned)) {
              containerNumbers.push(cleaned);
            }
          }
        });
      });
      
      if (containerNumbers.length === 0) {
        // If no standard format found, try to find any cell that might be a container number
        const flexiblePattern = /^[A-Z]{3,4}\d{6,7}$/;
        rowsProcessed = 0;
        
        worksheet.eachRow((row) => {
          if (rowsProcessed >= MAX_ROWS || containerNumbers.length >= MAX_CONTAINERS) return;
          rowsProcessed++;
          
          row.eachCell((cell) => {
            if (containerNumbers.length >= MAX_CONTAINERS) return;
            
            const value = cell.value;
            if (typeof value === 'string') {
              const cleaned = value.trim().toUpperCase();
              if (flexiblePattern.test(cleaned)) {
                containerNumbers.push(cleaned);
              }
            }
          });
        });
      }
      
      if (containerNumbers.length === 0) {
        setError('No valid container numbers found in the file. Container numbers should follow the format: 4 letters + 7 digits (e.g., MSCU1234567)');
        return;
      }
      
      const uniqueNumbers = [...new Set(containerNumbers)];
      
      if (uniqueNumbers.length > MAX_CONTAINERS) {
        setError(`Too many containers found (${uniqueNumbers.length}). Maximum is ${MAX_CONTAINERS} containers per file.`);
        return;
      }
      
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
                <span>Maximum file size: 5MB, up to 500 containers</span>
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
