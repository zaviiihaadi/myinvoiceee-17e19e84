import { ContainerData } from '@/types/container';
import { Package, Ship, MapPin, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatsCardsProps {
  data: ContainerData[];
  isTracking: boolean;
}

export function StatsCards({ data, isTracking }: StatsCardsProps) {
  const total = data.length;
  const inTransit = data.filter(d => d.status === 'In Transit').length;
  const arrived = data.filter(d => d.status === 'Arrived').length;
  const discharged = data.filter(d => d.status === 'Discharged').length;
  const errors = data.filter(d => d.error || d.status === 'Not Available').length;
  const tracking = data.filter(d => d.isTracking).length;

  const stats = [
    {
      label: 'Total Containers',
      value: total,
      icon: Package,
      color: 'bg-primary/10 text-primary',
      borderColor: 'border-primary/20'
    },
    {
      label: 'In Transit',
      value: inTransit,
      icon: Ship,
      color: 'bg-status-transit/10 text-status-transit',
      borderColor: 'border-status-transit/20'
    },
    {
      label: 'Arrived',
      value: arrived,
      icon: MapPin,
      color: 'bg-status-arrived/10 text-status-arrived',
      borderColor: 'border-status-arrived/20'
    },
    {
      label: 'Discharged',
      value: discharged,
      icon: CheckCircle2,
      color: 'bg-status-discharged/10 text-status-discharged',
      borderColor: 'border-status-discharged/20'
    },
    {
      label: isTracking ? 'Tracking...' : 'Errors',
      value: isTracking ? tracking : errors,
      icon: isTracking ? Clock : AlertTriangle,
      color: isTracking ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive',
      borderColor: isTracking ? 'border-primary/20' : 'border-destructive/20'
    }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(
            'relative overflow-hidden rounded-xl border p-4 bg-card shadow-sm transition-all duration-300 hover:shadow-md',
            stat.borderColor,
            'animate-fade-in'
          )}
          style={{ animationDelay: `${index * 100}ms` }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-bold mt-1">
                {isTracking && stat.label === 'Tracking...' ? (
                  <span className="flex items-center gap-2">
                    {stat.value}
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  </span>
                ) : (
                  stat.value
                )}
              </p>
            </div>
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', stat.color)}>
              <stat.icon className="w-5 h-5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
