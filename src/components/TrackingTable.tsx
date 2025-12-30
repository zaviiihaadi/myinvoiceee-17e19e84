import { ContainerData, ContainerStatus } from '@/types/container';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Ship, 
  MapPin, 
  Calendar, 
  Clock, 
  AlertCircle,
  Loader2,
  Anchor,
  CheckCircle2,
  Package,
  Timer
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrackingTableProps {
  data: ContainerData[];
}

function getStatusConfig(status: ContainerStatus) {
  switch (status) {
    case 'In Transit':
      return { 
        color: 'bg-status-transit/15 text-status-transit border-status-transit/30', 
        icon: Ship,
        label: 'In Transit'
      };
    case 'Arrived':
      return { 
        color: 'bg-status-arrived/15 text-status-arrived border-status-arrived/30', 
        icon: CheckCircle2,
        label: 'Arrived'
      };
    case 'Discharged':
      return { 
        color: 'bg-status-discharged/15 text-status-discharged border-status-discharged/30', 
        icon: Package,
        label: 'Discharged'
      };
    case 'Loading':
      return { 
        color: 'bg-primary/15 text-primary border-primary/30', 
        icon: Anchor,
        label: 'Loading'
      };
    case 'Pending':
      return { 
        color: 'bg-status-pending/15 text-status-pending border-status-pending/30', 
        icon: Timer,
        label: 'Pending'
      };
    default:
      return { 
        color: 'bg-muted text-muted-foreground border-border', 
        icon: AlertCircle,
        label: 'Not Available'
      };
  }
}

function StatusBadge({ status }: { status: ContainerStatus }) {
  const config = getStatusConfig(status);
  const Icon = config.icon;
  
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
      config.color
    )}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

export function TrackingTable({ data }: TrackingTableProps) {
  if (data.length === 0) {
    return null;
  }

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-md animate-fade-in">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="font-semibold">Container</TableHead>
              <TableHead className="font-semibold">Shipping Line</TableHead>
              <TableHead className="font-semibold">Location</TableHead>
              <TableHead className="font-semibold">Vessel</TableHead>
              <TableHead className="font-semibold">Voyage</TableHead>
              <TableHead className="font-semibold">ETA Port</TableHead>
              <TableHead className="font-semibold">ETA Date</TableHead>
              <TableHead className="font-semibold">Last Update</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((container, index) => (
              <TableRow 
                key={container.containerNumber}
                className={cn(
                  'transition-all duration-300 hover:bg-muted/30',
                  container.isTracking && 'bg-primary/5'
                )}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <TableCell className="font-mono font-medium">
                  <div className="flex items-center gap-2">
                    {container.isTracking ? (
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    ) : (
                      <Package className="w-4 h-4 text-muted-foreground" />
                    )}
                    {container.containerNumber}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Ship className="w-4 h-4 text-primary" />
                    {container.shippingLine || '-'}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-accent" />
                    <span className="max-w-[150px] truncate">
                      {container.currentLocation || '-'}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="max-w-[120px] truncate block">
                    {container.vesselName || '-'}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {container.voyageNumber || '-'}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Anchor className="w-4 h-4 text-primary" />
                    <span className="max-w-[150px] truncate">
                      {container.destinationPort || 'Mohammad Bin Qasim'}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    {container.eta || '-'}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    {container.lastUpdate || '-'}
                  </div>
                </TableCell>
                <TableCell>
                  {container.error ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-destructive/10 text-destructive border border-destructive/20">
                      <AlertCircle className="w-3 h-3" />
                      Error
                    </span>
                  ) : (
                    <StatusBadge status={container.status} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
