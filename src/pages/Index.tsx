import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { FileUpload } from '@/components/FileUpload';
import { ManualEntryForm } from '@/components/ManualEntryForm';
import { TrackingTable } from '@/components/TrackingTable';
import { StatsCards } from '@/components/StatsCards';
import { ExportButtons } from '@/components/ExportButtons';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { EmailNotificationForm } from '@/components/EmailNotificationForm';
import { ContainerData } from '@/types/container';
import { trackContainer, trackContainers } from '@/services/trackingService';
import { sendStatusNotification, detectStatusChanges } from '@/services/notificationService';
import { fetchUserContainers, upsertContainer, upsertContainers, deleteAllContainers, deleteContainers } from '@/services/containerDbService';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { RefreshCcw, FileSpreadsheet, Sparkles, Search, Clock, Bell, Loader2, Ship, Globe, Zap, Shield, ChevronRight, Container } from 'lucide-react';
import { toast } from 'sonner';

const AUTO_REFRESH_INTERVAL = 3 * 60 * 60 * 1000; // 3 hours in milliseconds

const Index = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [containerNumbers, setContainerNumbers] = useState<string[]>([]);
  const [trackingData, setTrackingData] = useState<ContainerData[]>([]);
  const [isTracking, setIsTracking] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [trackingProgress, setTrackingProgress] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [nextRefresh, setNextRefresh] = useState<Date | null>(null);
  const [notificationEmail, setNotificationEmail] = useState<string | null>(() => {
    return localStorage.getItem('cargotrack_notification_email');
  });
  const autoRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousDataRef = useRef<ContainerData[]>([]);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Load containers from database on mount
  useEffect(() => {
    const loadContainers = async () => {
      if (!user) return;
      
      try {
        const containers = await fetchUserContainers();
        setTrackingData(containers);
        setContainerNumbers(containers.map(c => c.containerNumber));
      } catch (error) {
        console.error('Error loading containers:', error);
        toast.error('Failed to load your containers');
      } finally {
        setIsLoadingData(false);
      }
    };

    if (user) {
      loadContainers();
    }
  }, [user]);

  // Auto-refresh effect
  useEffect(() => {
    if (containerNumbers.length > 0 && !isTracking) {
      if (autoRefreshTimerRef.current) {
        clearTimeout(autoRefreshTimerRef.current);
      }
      
      const nextTime = new Date(Date.now() + AUTO_REFRESH_INTERVAL);
      setNextRefresh(nextTime);
      
      autoRefreshTimerRef.current = setTimeout(() => {
        toast.info('Auto-refreshing tracking data...');
        handleRefreshAll();
      }, AUTO_REFRESH_INTERVAL);
    }

    return () => {
      if (autoRefreshTimerRef.current) {
        clearTimeout(autoRefreshTimerRef.current);
      }
    };
  }, [containerNumbers.length, isTracking, lastRefresh]);

  // Check for status changes and send notifications
  const checkAndSendNotifications = useCallback(async (newData: ContainerData[]) => {
    if (!notificationEmail || previousDataRef.current.length === 0) return;
    
    const changes = detectStatusChanges(previousDataRef.current, newData);
    
    for (const { container, oldStatus } of changes) {
      console.log(`Status change detected: ${container.containerNumber} ${oldStatus} -> ${container.status}`);
      const result = await sendStatusNotification(
        notificationEmail,
        container.containerNumber,
        oldStatus,
        container.status,
        container.vesselName,
        container.eta,
        container.destinationPort
      );
      
      if (result.success) {
        toast.success(`Notification sent for ${container.containerNumber}`);
      }
    }
  }, [notificationEmail]);

  // Save tracking data to localStorage for dashboard
  const saveTrackingData = useCallback((data: ContainerData[]) => {
    localStorage.setItem('cargotrack_tracking_data', JSON.stringify(data));
    
    const now = new Date();
    const counts: Record<string, number> = {
      'In Transit': 0,
      'Arrived': 0,
      'Discharged': 0,
      'Loading': 0,
      'Pending': 0,
      'Not Available': 0,
    };
    
    data.forEach(container => {
      if (counts[container.status] !== undefined) {
        counts[container.status]++;
      }
    });
    
    const historyEntry = {
      timestamp: now.toISOString(),
      date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      counts,
    };
    
    const existingHistory = localStorage.getItem('cargotrack_status_history');
    let history = existingHistory ? JSON.parse(existingHistory) : [];
    history.push(historyEntry);
    if (history.length > 50) {
      history = history.slice(-50);
    }
    localStorage.setItem('cargotrack_status_history', JSON.stringify(history));
  }, []);

  const handleRefreshAll = useCallback(async () => {
    if (containerNumbers.length === 0 || isTracking || !user) return;
    
    previousDataRef.current = [...trackingData];
    
    setIsTracking(true);
    setTrackingProgress(0);
    
    setTrackingData(prev => prev.map(item => ({ ...item, isTracking: true })));
    
    const newResults: ContainerData[] = [];
    
    try {
      await trackContainers(containerNumbers, (completed, data) => {
        setTrackingProgress(completed);
        newResults.push(data);
        setTrackingData(prev => 
          prev.map(item => 
            item.containerNumber === data.containerNumber 
              ? { ...data, isTracking: false }
              : item
          )
        );
      });
      
      // Save to database
      await upsertContainers(newResults, user.id);
      
      await checkAndSendNotifications(newResults);
      saveTrackingData(newResults);
      
      setLastRefresh(new Date());
      toast.success('All containers refreshed!');
    } catch (error) {
      console.error('Refresh error:', error);
      toast.error('Some containers failed to refresh');
    } finally {
      setIsTracking(false);
    }
  }, [containerNumbers, isTracking, trackingData, user, checkAndSendNotifications, saveTrackingData]);

  const handleSubscribe = useCallback((email: string) => {
    setNotificationEmail(email);
    localStorage.setItem('cargotrack_notification_email', email);
  }, []);

  const handleUnsubscribe = useCallback(() => {
    setNotificationEmail(null);
    localStorage.removeItem('cargotrack_notification_email');
    toast.info('Email notifications disabled');
  }, []);

  const handleFileProcessed = useCallback(async (numbers: string[]) => {
    if (!user) return;
    
    // Filter out containers that already exist
    const existingNumbers = new Set(trackingData.map(c => c.containerNumber));
    const newNumbers = numbers.filter(num => !existingNumbers.has(num));
    
    if (newNumbers.length === 0) {
      toast.info(`All ${numbers.length} containers are already being tracked`);
      return;
    }
    
    // Merge with existing container numbers
    const allNumbers = [...containerNumbers, ...newNumbers];
    setContainerNumbers(allNumbers);
    
    toast.success(`Found ${numbers.length} containers, tracking ${newNumbers.length} new ones!`);
    
    const initialData: ContainerData[] = newNumbers.map(num => ({
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
    
    // Add new containers to existing tracking data
    setTrackingData(prev => [...prev, ...initialData]);
    
    setIsTracking(true);
    setTrackingProgress(0);
    
    const results: ContainerData[] = [];
    
    try {
      await trackContainers(newNumbers, async (completed, data) => {
        setTrackingProgress(completed);
        results.push(data);
        setTrackingData(prev => 
          prev.map(item => 
            item.containerNumber === data.containerNumber 
              ? { ...data, isTracking: false }
              : item
          )
        );
        
        // Save each container to database as it completes
        await upsertContainer(data, user.id);
      });
      
      // Save all tracking data including previously existing ones
      setTrackingData(prev => {
        saveTrackingData(prev);
        return prev;
      });
      
      toast.success(`${newNumbers.length} containers tracked successfully!`);
    } catch (error) {
      console.error('Tracking error:', error);
      toast.error('Some containers failed to track');
    } finally {
      setIsTracking(false);
    }
  }, [user, saveTrackingData, trackingData, containerNumbers]);

  const handleManualTrack = useCallback(async (containerNumber: string) => {
    if (!user) return;
    
    if (trackingData.some(c => c.containerNumber === containerNumber)) {
      toast.info('Container is already in the tracking list');
      return;
    }

    setContainerNumbers(prev => [...prev, containerNumber]);
    
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
      
      // Save to database
      await upsertContainer(data, user.id);
      
      setTrackingData(prev => {
        const updated = prev.map(item => 
          item.containerNumber === containerNumber 
            ? { ...data, isTracking: false }
            : item
        );
        saveTrackingData(updated);
        return updated;
      });
      
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
  }, [trackingData, user, saveTrackingData]);

  const handleClear = useCallback(async () => {
    try {
      await deleteAllContainers();
      setContainerNumbers([]);
      setTrackingData([]);
      setTrackingProgress(0);
      setLastRefresh(null);
      setNextRefresh(null);
      localStorage.removeItem('cargotrack_tracking_data');
      localStorage.removeItem('cargotrack_status_history');
      if (autoRefreshTimerRef.current) {
        clearTimeout(autoRefreshTimerRef.current);
      }
      toast.success('All containers cleared');
    } catch (error) {
      console.error('Error clearing containers:', error);
      toast.error('Failed to clear containers');
    }
  }, []);

  const handleDeleteSelected = useCallback(async (containerNumbersToDelete: string[]) => {
    try {
      await deleteContainers(containerNumbersToDelete);
      setContainerNumbers(prev => prev.filter(n => !containerNumbersToDelete.includes(n)));
      setTrackingData(prev => prev.filter(c => !containerNumbersToDelete.includes(c.containerNumber)));
      toast.success(`${containerNumbersToDelete.length} container${containerNumbersToDelete.length > 1 ? 's' : ''} deleted`);
    } catch (error) {
      console.error('Error deleting containers:', error);
      toast.error('Failed to delete containers');
    }
  }, []);

  // Show loading while checking auth
  if (authLoading || (user && isLoadingData)) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Loading your containers...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      <Header />
      
      <main className="flex-1">
        {/* Beautiful Hero Section */}
        {trackingData.length === 0 && (
          <section className="relative py-16 md:py-24 overflow-hidden">
            {/* Animated background blobs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-20 left-10 w-72 h-72 bg-primary/20 rounded-full blur-3xl animate-blob" />
              <div className="absolute top-40 right-10 w-96 h-96 bg-accent/15 rounded-full blur-3xl animate-blob" style={{ animationDelay: '2s' }} />
              <div className="absolute bottom-20 left-1/3 w-80 h-80 bg-secondary/30 rounded-full blur-3xl animate-blob" style={{ animationDelay: '4s' }} />
            </div>
            
            <div className="container mx-auto px-4 relative z-10">
              <div className="text-center space-y-8 max-w-4xl mx-auto">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-card border border-border shadow-md animate-fade-in-down">
                  <div className="w-2 h-2 rounded-full bg-status-arrived animate-pulse" />
                  <span className="text-sm font-medium text-foreground">Live Container Tracking</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
                
                {/* Main heading */}
                <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold font-display leading-tight animate-fade-in-up tracking-tight">
                  Track Your Cargo
                  <br />
                  <span className="text-gradient">Across the Globe</span>
                </h1>
                
                {/* Subheading */}
                <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                  Real-time visibility for your shipments. Connect with MSC, Maersk, CMA CGM, and 5+ major shipping lines instantly.
                </p>
                
                {/* Feature pills */}
                <div className="flex flex-wrap justify-center gap-3 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border shadow-sm">
                    <Globe className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">Global Coverage</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border shadow-sm">
                    <Zap className="w-4 h-4 text-status-transit" />
                    <span className="text-sm font-medium">Instant Updates</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border shadow-sm">
                    <Shield className="w-4 h-4 text-status-arrived" />
                    <span className="text-sm font-medium">Secure & Reliable</span>
                  </div>
                </div>
              </div>
              
              {/* Floating container icons */}
              <div className="hidden lg:block absolute top-1/4 left-8 animate-float">
                <div className="w-16 h-16 rounded-2xl bg-card border border-border shadow-lg flex items-center justify-center">
                  <Container className="w-8 h-8 text-primary" />
                </div>
              </div>
              <div className="hidden lg:block absolute top-1/3 right-12 animate-float-delayed">
                <div className="w-14 h-14 rounded-2xl bg-card border border-border shadow-lg flex items-center justify-center">
                  <Ship className="w-7 h-7 text-accent" />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Main Content Container */}
        <div className="container mx-auto px-4 pb-12 space-y-8">
          {/* Manual Entry Section */}
          <section className="max-w-2xl mx-auto animate-fade-in-up" style={{ animationDelay: '300ms' }}>
            <div className="bg-card rounded-3xl border border-border shadow-xl p-6 md:p-8 hover-lift card-shine">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-ocean-gradient flex items-center justify-center shadow-md">
                  <Search className="w-6 h-6 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-display text-foreground">Track a Container</h3>
                  <p className="text-sm text-muted-foreground">Enter your container number to get instant updates</p>
                </div>
              </div>
              <ManualEntryForm 
                onTrack={handleManualTrack}
                isTracking={isTracking}
              />
            </div>
          </section>

          {/* Upload Section */}
          <section className="max-w-2xl mx-auto animate-fade-in-up" style={{ animationDelay: '400ms' }}>
            <div className="bg-card rounded-3xl border border-border shadow-xl p-6 md:p-8 hover-lift card-shine">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-sunset-gradient flex items-center justify-center shadow-md">
                  <FileSpreadsheet className="w-6 h-6 text-accent-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-display text-foreground">Bulk Upload</h3>
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
            <section className="space-y-8 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
              {/* Stats */}
              <StatsCards data={trackingData} isTracking={isTracking} />
              
              {/* Email Notifications */}
              <div className="bg-card rounded-2xl border border-border shadow-lg p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-aurora-gradient flex items-center justify-center">
                    <Bell className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Email Notifications</span>
                    <p className="text-sm text-muted-foreground">Get alerts when status changes</p>
                  </div>
                </div>
                <EmailNotificationForm
                  subscribedEmail={notificationEmail}
                  onSubscribe={handleSubscribe}
                  onUnsubscribe={handleUnsubscribe}
                />
              </div>
              
              {/* Actions */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  {nextRefresh && !isTracking && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border px-4 py-2 rounded-full shadow-sm">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Auto-refresh in 3h</span>
                    </div>
                  )}
                  <Button
                    onClick={handleRefreshAll}
                    disabled={isTracking}
                    variant="outline"
                    className="gap-2 rounded-xl"
                  >
                    <RefreshCcw className="w-4 h-4" />
                    Refresh All
                  </Button>
                  <Button
                    onClick={handleClear}
                    disabled={isTracking}
                    variant="ghost"
                    className="text-muted-foreground rounded-xl"
                  >
                    Clear Results
                  </Button>
                </div>
                <ExportButtons data={trackingData} disabled={isTracking} />
              </div>
              
              {/* Table */}
              <TrackingTable 
                data={trackingData} 
                onDeleteSelected={handleDeleteSelected}
                isDeleting={isTracking}
              />
            </section>
          )}
        </div>
      </main>

      {/* Beautiful Footer */}
      <footer className="relative border-t border-border py-12 mt-auto overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-muted/30 to-transparent pointer-events-none" />
        <div className="container mx-auto px-4 relative z-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <p className="text-xl font-extrabold font-display tracking-tight">
                <span className="text-foreground">Cargo</span>
                <span className="text-gradient">Track</span>
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} CargoTrack. All rights reserved.
            </p>
          </div>
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
