import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface RealTimeETAProps {
  eta: string;
}

function parseETA(eta: string): Date | null {
  if (!eta) return null;
  
  // Try parsing various date formats
  const date = new Date(eta);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  return null;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Arrived';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  
  return `${seconds}s`;
}

export function RealTimeETA({ eta }: RealTimeETAProps) {
  const [countdown, setCountdown] = useState<string>('');
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const etaDate = parseETA(eta);
    
    if (!etaDate) {
      setCountdown(eta || '-');
      setIsLive(false);
      return;
    }

    const updateCountdown = () => {
      const now = new Date();
      const diff = etaDate.getTime() - now.getTime();
      setCountdown(formatCountdown(diff));
      setIsLive(diff > 0);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    
    return () => clearInterval(interval);
  }, [eta]);

  if (!eta) {
    return <span className="text-muted-foreground">-</span>;
  }

  const etaDate = parseETA(eta);

  return (
    <div className="flex flex-col gap-0.5">
      {etaDate && (
        <span className="text-xs text-muted-foreground">
          {etaDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        {isLive && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
        )}
        <span className={`font-mono text-sm ${isLive ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
          {countdown}
        </span>
      </div>
    </div>
  );
}
