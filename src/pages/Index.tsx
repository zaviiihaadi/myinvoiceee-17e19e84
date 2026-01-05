import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { FileUpload } from '@/components/FileUpload';
import { ManualEntryForm } from '@/components/ManualEntryForm';
import { TrackingTable } from '@/components/TrackingTable';
import { StatsCards } from '@/components/StatsCards';
import { ExportButtons } from '@/components/ExportButtons';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { ContainerData } from '@/types/container';
import { trackContainer, trackContainers } from '@/services/trackingService';
import { Button } from '@/components/ui/button';
import { RefreshCcw, FileSpreadsheet, Sparkles, Search } from 'lucide-react';
import { toast } from 'sonner';

const Index = () => {
  const [containerNumbers, setContainerNumbers] = useState<string[]>([]);
  const [trackingData, setTrackingData] = useState<ContainerData[]>([]);
  const [isTracking, setIsTracking] = useState(false);
  const [trackingProgress, setTrackingProgress] = useState(0);

  const handleFileProcessed = useCallback(async (numbers: string[]) => {
    setContainerNumbers(numbers);
    toast.success(`Found ${numbers.length} container numbers!`);
    
    // Initialize tracking data with "tracking" state
    const initialData: ContainerData[] = numbers.map(num => ({
      containerNumber: num,
      shippingLine: '',
      currentLocation: '',
      vesselName: '',
      voyageNumber: '',
      eta: '',
      lastUpdate: '',
      status: 'Pending',
      isTracking: true
    }));
    setTrackingData(initialData);
    
    // Start tracking
    setIsTracking(true);
    setTrackingProgress(0);
    
    try {
      await trackContainers(numbers, (completed, data) => {
        setTrackingProgress(completed);
        setTrackingData(prev => 
          prev.map(item => 
            item.containerNumber === data.containerNumber 
              ? { ...data, isTracking: false }
              : item
          )
        );
      });
      
      toast.success('All containers tracked successfully!');
    } catch (error) {
      console.error('Tracking error:', error);
      toast.error('Some containers failed to track');
    } finally {
      setIsTracking(false);
    }
  }, []);

  const handleManualTrack = useCallback(async (containerNumber: string) => {
    // Check if already tracking this container
    if (trackingData.some(c => c.containerNumber === containerNumber)) {
      toast.info('Container is already in the tracking list');
      return;
    }

    // Add to lists
    setContainerNumbers(prev => [...prev, containerNumber]);
    
    // Add with tracking state
    const newContainer: ContainerData = {
      containerNumber,
      shippingLine: '',
      currentLocation: '',
      vesselName: '',
      voyageNumber: '',
      eta: '',
      lastUpdate: '',
      status: 'Pending',
      isTracking: true
    };
    setTrackingData(prev => [...prev, newContainer]);
    
    toast.info(`Tracking ${containerNumber}...`);
    
    try {
      const result = await trackContainer(containerNumber);
      const data = result.data || {
        containerNumber,
        shippingLine: '',
        currentLocation: '',
        vesselName: '',
        voyageNumber: '',
        eta: '',
        lastUpdate: '',
        status: 'Not Available' as const,
        error: result.error
      };
      
      setTrackingData(prev => 
        prev.map(item => 
          item.containerNumber === containerNumber 
            ? { ...data, isTracking: false }
            : item
        )
      );
      
      if (result.success) {
        toast.success(`${containerNumber} tracked successfully!`);
      } else {
        toast.error(`Failed to track ${containerNumber}`);
      }
    } catch (error) {
      console.error('Manual tracking error:', error);
      setTrackingData(prev => 
        prev.map(item => 
          item.containerNumber === containerNumber 
            ? { ...item, isTracking: false, status: 'Not Available', error: 'Tracking failed' }
            : item
        )
      );
      toast.error(`Failed to track ${containerNumber}`);
    }
  }, [trackingData]);

  const handleRefresh = useCallback(() => {
    if (containerNumbers.length > 0) {
      handleFileProcessed(containerNumbers);
    }
  }, [containerNumbers, handleFileProcessed]);

  const handleClear = useCallback(() => {
    setContainerNumbers([]);
    setTrackingData([]);
    setTrackingProgress(0);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-1 container mx-auto px-4 py-8 space-y-8">
        {/* Hero Section */}
        {trackingData.length === 0 && (
          <section className="text-center space-y-6 py-8 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              Real-time Container Tracking
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground max-w-2xl mx-auto">
              Track your containers across{' '}
              <span className="text-gradient">multiple shipping lines</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Upload your Excel file with container numbers and get instant tracking updates from MSC, Maersk, CMA CGM, and more.
            </p>
          </section>
        )}

        {/* Manual Entry Section */}
        <section className="max-w-2xl mx-auto animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div className="bg-card rounded-2xl border border-border shadow-lg p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Search className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Track a Container</h3>
                <p className="text-sm text-muted-foreground">Enter container number to track instantly</p>
              </div>
            </div>
            <ManualEntryForm 
              onTrack={handleManualTrack}
              isTracking={isTracking}
            />
          </div>
        </section>

        {/* Upload Section */}
        <section className="max-w-2xl mx-auto animate-fade-in-up" style={{ animationDelay: '150ms' }}>
          <div className="bg-card rounded-2xl border border-border shadow-lg p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Bulk Upload</h3>
                <p className="text-sm text-muted-foreground">Upload Excel file with multiple containers</p>
              </div>
            </div>
            <FileUpload 
              onFileProcessed={handleFileProcessed} 
              isProcessing={isTracking}
            />
          </div>
        </section>

        {/* Results Section */}
        {trackingData.length > 0 && (
          <section className="space-y-6 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            {/* Stats */}
            <StatsCards data={trackingData} isTracking={isTracking} />
            
            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleRefresh}
                  disabled={isTracking}
                  variant="outline"
                  className="gap-2"
                >
                  <RefreshCcw className="w-4 h-4" />
                  Refresh All
                </Button>
                <Button
                  onClick={handleClear}
                  disabled={isTracking}
                  variant="ghost"
                  className="text-muted-foreground"
                >
                  Clear Results
                </Button>
              </div>
              <ExportButtons data={trackingData} disabled={isTracking} />
            </div>
            
            {/* Table */}
            <TrackingTable data={trackingData} />
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-auto">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>CargoTrack Pro — Real-time container tracking across major shipping lines</p>
        </div>
      </footer>

      {/* Loading Overlay */}
      {isTracking && trackingData.length > 0 && (
        <LoadingOverlay 
          progress={trackingProgress} 
          total={containerNumbers.length} 
        />
      )}
    </div>
  );
};

export default Index;
