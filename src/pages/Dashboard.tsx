import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Header } from '@/components/Header';
import { ContainerData, ContainerStatus } from '@/types/container';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Area, AreaChart } from 'recharts';
import { Package, TrendingUp, Activity, Ship, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { fetchUserContainers } from '@/services/containerDbService';

const STATUS_COLORS: Record<ContainerStatus, string> = {
  'In Transit': 'hsl(var(--status-transit))',
  'Arrived': 'hsl(var(--status-arrived))',
  'Discharged': 'hsl(var(--status-discharged))',
  'Loading': 'hsl(210, 85%, 55%)',
  'Pending': 'hsl(var(--status-pending))',
  'Not Available': 'hsl(0, 0%, 60%)',
};

const chartConfig = {
  'In Transit': { label: 'In Transit', color: 'hsl(45 95% 55%)' },
  'Arrived': { label: 'Arrived', color: 'hsl(145 65% 42%)' },
  'Discharged': { label: 'Discharged', color: 'hsl(210 85% 55%)' },
  'Loading': { label: 'Loading', color: 'hsl(210 85% 55%)' },
  'Pending': { label: 'Pending', color: 'hsl(220 15% 55%)' },
  'Not Available': { label: 'Not Available', color: 'hsl(0 0% 60%)' },
};

interface StatusHistoryEntry {
  timestamp: string;
  date: string;
  counts: Record<ContainerStatus, number>;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [trackingData, setTrackingData] = useState<ContainerData[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Load tracking data from database and localStorage for history
  useEffect(() => {
    const loadData = async () => {
      if (!user) return;
      
      try {
        // Load containers from database
        const containers = await fetchUserContainers();
        setTrackingData(containers);
        
        // Also save to localStorage for dashboard sync
        localStorage.setItem('cargotrack_tracking_data', JSON.stringify(containers));
      } catch (error) {
        console.error('Failed to load containers:', error);
      }

      // Load history from localStorage
      const storedHistory = localStorage.getItem('cargotrack_status_history');
      if (storedHistory) {
        try {
          setStatusHistory(JSON.parse(storedHistory));
        } catch (e) {
          console.error('Failed to parse status history:', e);
        }
      }
      
      setIsLoading(false);
    };

    if (user) {
      loadData();
    }
    
    // Listen for storage changes from other tabs/components
    const handleStorageChange = () => {
      const storedHistory = localStorage.getItem('cargotrack_status_history');
      if (storedHistory) {
        try {
          setStatusHistory(JSON.parse(storedHistory));
        } catch (e) {
          console.error('Failed to parse status history:', e);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [user]);

  // Calculate status distribution
  const statusDistribution = useMemo(() => {
    const counts: Record<ContainerStatus, number> = {
      'In Transit': 0,
      'Arrived': 0,
      'Discharged': 0,
      'Loading': 0,
      'Pending': 0,
      'Not Available': 0,
    };

    trackingData.forEach(container => {
      if (counts[container.status] !== undefined) {
        counts[container.status]++;
      }
    });

    return Object.entries(counts)
      .filter(([_, count]) => count > 0)
      .map(([status, count]) => ({
        name: status,
        value: count,
        fill: STATUS_COLORS[status as ContainerStatus],
      }));
  }, [trackingData]);

  // Calculate shipping line distribution
  const shippingLineDistribution = useMemo(() => {
    const counts: Record<string, number> = {};

    trackingData.forEach(container => {
      const line = container.shippingLine || 'Unknown';
      counts[line] = (counts[line] || 0) + 1;
    });

    return Object.entries(counts)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({
        name: name.length > 15 ? name.substring(0, 15) + '...' : name,
        count,
      }));
  }, [trackingData]);

  // Format history for chart
  const historyChartData = useMemo(() => {
    return statusHistory.slice(-10).map(entry => ({
      date: entry.date,
      ...entry.counts,
    }));
  }, [statusHistory]);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </main>
      </div>
    );
  }

  if (trackingData.length === 0) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 container mx-auto px-4 py-8 flex items-center justify-center">
          <Card className="max-w-md w-full text-center">
            <CardHeader>
              <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Package className="w-8 h-8 text-muted-foreground" />
              </div>
              <CardTitle>No Tracking Data</CardTitle>
              <CardDescription>
                Start tracking containers to see analytics and status distribution charts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/">
                <Button className="gap-2">
                  <Ship className="w-4 h-4" />
                  Go to Tracking
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-1 container mx-auto px-4 py-8 space-y-8">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Analytics Dashboard</h2>
            <p className="text-muted-foreground">Container status distribution and tracking insights</p>
          </div>
          <Link to="/">
            <Button variant="outline" className="gap-2">
              <Ship className="w-4 h-4" />
              Back to Tracking
            </Button>
          </Link>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Containers</CardDescription>
              <CardTitle className="text-3xl">{trackingData.length}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Package className="w-3 h-3" />
                <span>Being tracked</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>In Transit</CardDescription>
              <CardTitle className="text-3xl text-[hsl(var(--status-transit))]">
                {trackingData.filter(c => c.status === 'In Transit').length}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="w-3 h-3" />
                <span>Currently moving</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Arrived</CardDescription>
              <CardTitle className="text-3xl text-[hsl(var(--status-arrived))]">
                {trackingData.filter(c => c.status === 'Arrived').length}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Activity className="w-3 h-3" />
                <span>At destination</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Shipping Lines</CardDescription>
              <CardTitle className="text-3xl">
                {new Set(trackingData.map(c => c.shippingLine).filter(Boolean)).size}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Ship className="w-3 h-3" />
                <span>Active carriers</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status Distribution Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Status Distribution</CardTitle>
              <CardDescription>Current container status breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[300px]">
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={false}
                  >
                    {statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Shipping Line Distribution Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Containers by Shipping Line</CardTitle>
              <CardDescription>Distribution across carriers</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={{ count: { label: 'Containers', color: 'hsl(var(--primary))' } }} className="h-[300px]">
                <BarChart data={shippingLineDistribution} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Status Over Time */}
          {historyChartData.length > 1 && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Status Trends Over Time</CardTitle>
                <CardDescription>Historical status distribution from tracking refreshes</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[300px]">
                  <AreaChart data={historyChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="In Transit" stackId="1" stroke="hsl(45 95% 55%)" fill="hsl(45 95% 55% / 0.6)" />
                    <Area type="monotone" dataKey="Arrived" stackId="1" stroke="hsl(145 65% 42%)" fill="hsl(145 65% 42% / 0.6)" />
                    <Area type="monotone" dataKey="Discharged" stackId="1" stroke="hsl(210 85% 55%)" fill="hsl(210 85% 55% / 0.6)" />
                    <Area type="monotone" dataKey="Pending" stackId="1" stroke="hsl(220 15% 55%)" fill="hsl(220 15% 55% / 0.6)" />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-auto">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>CargoTrack Pro — Real-time container tracking across major shipping lines</p>
        </div>
      </footer>
    </div>
  );
};

export default Dashboard;
