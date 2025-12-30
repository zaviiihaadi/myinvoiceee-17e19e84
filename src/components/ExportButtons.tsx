import { ContainerData } from '@/types/container';
import { Button } from '@/components/ui/button';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface ExportButtonsProps {
  data: ContainerData[];
  disabled?: boolean;
}

export function ExportButtons({ data, disabled }: ExportButtonsProps) {
  const exportToExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      
      const exportData = data.map(container => ({
        'Container Number': container.containerNumber,
        'Shipping Line': container.shippingLine,
        'Current Location': container.currentLocation,
        'Vessel Name': container.vesselName,
        'Voyage Number': container.voyageNumber,
        'ETA': container.eta,
        'Last Update': container.lastUpdate,
        'Status': container.status,
        'Error': container.error || ''
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Tracking Results');
      
      // Auto-size columns
      const colWidths = Object.keys(exportData[0] || {}).map(key => ({
        wch: Math.max(key.length, 15)
      }));
      worksheet['!cols'] = colWidths;
      
      XLSX.writeFile(workbook, `container_tracking_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Excel file downloaded successfully!');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export Excel file');
    }
  };

  const exportToCSV = () => {
    try {
      const headers = [
        'Container Number',
        'Shipping Line',
        'Current Location',
        'Vessel Name',
        'Voyage Number',
        'ETA',
        'Last Update',
        'Status',
        'Error'
      ];
      
      const rows = data.map(container => [
        container.containerNumber,
        container.shippingLine,
        container.currentLocation,
        container.vesselName,
        container.voyageNumber,
        container.eta,
        container.lastUpdate,
        container.status,
        container.error || ''
      ]);
      
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `container_tracking_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      
      toast.success('CSV file downloaded successfully!');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export CSV file');
    }
  };

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        onClick={exportToExcel}
        disabled={disabled || data.length === 0}
        className="gap-2 bg-status-arrived hover:bg-status-arrived/90 text-status-arrived-foreground"
      >
        <FileSpreadsheet className="w-4 h-4" />
        Export Excel
      </Button>
      <Button
        onClick={exportToCSV}
        disabled={disabled || data.length === 0}
        variant="outline"
        className="gap-2"
      >
        <FileText className="w-4 h-4" />
        Export CSV
      </Button>
    </div>
  );
}
