import { ContainerData } from '@/types/container';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface ExportButtonsProps {
  data: ContainerData[];
  disabled?: boolean;
}

export function ExportButtons({ data, disabled }: ExportButtonsProps) {
  const exportToExcel = async () => {
    try {
      const ExcelJS = await import('exceljs');
      
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Tracking Results');
      
      // Add headers
      worksheet.columns = [
        { header: 'Container Number', key: 'containerNumber', width: 20 },
        { header: 'Shipping Line', key: 'shippingLine', width: 15 },
        { header: 'Current Location', key: 'currentLocation', width: 20 },
        { header: 'Vessel Name', key: 'vesselName', width: 20 },
        { header: 'Voyage Number', key: 'voyageNumber', width: 15 },
        { header: 'ETA', key: 'eta', width: 15 },
        { header: 'Last Update', key: 'lastUpdate', width: 20 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Error', key: 'error', width: 25 }
      ];
      
      // Add data rows
      data.forEach(container => {
        worksheet.addRow({
          containerNumber: container.containerNumber,
          shippingLine: container.shippingLine,
          currentLocation: container.currentLocation,
          vesselName: container.vesselName,
          voyageNumber: container.voyageNumber,
          eta: container.eta,
          lastUpdate: container.lastUpdate,
          status: container.status,
          error: container.error || ''
        });
      });
      
      // Style header row
      worksheet.getRow(1).font = { bold: true };
      
      // Generate buffer and download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `container_tracking_${new Date().toISOString().split('T')[0]}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      
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
