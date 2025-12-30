import { Ship, Anchor, Container } from 'lucide-react';

interface LoadingOverlayProps {
  progress: number;
  total: number;
}

export function LoadingOverlay({ progress, total }: LoadingOverlayProps) {
  const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;
  
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-card rounded-2xl shadow-xl border border-border p-8 max-w-md w-full mx-4 animate-scale-in">
        <div className="flex flex-col items-center text-center">
          {/* Animated ship */}
          <div className="relative w-24 h-24 mb-6">
            <div className="absolute inset-0 rounded-full bg-primary/10 animate-pulse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Ship className="w-12 h-12 text-primary animate-float" />
            </div>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
          
          <h3 className="text-xl font-semibold text-foreground mb-2">
            Tracking Containers
          </h3>
          <p className="text-muted-foreground mb-6">
            Fetching real-time data from shipping lines...
          </p>
          
          {/* Progress bar */}
          <div className="w-full mb-4">
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-ocean-gradient transition-all duration-500 ease-out rounded-full"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
          
          <div className="flex items-center justify-between w-full text-sm">
            <span className="text-muted-foreground">
              {progress} of {total} containers
            </span>
            <span className="font-semibold text-primary">
              {percentage}%
            </span>
          </div>
          
          {/* Decorative icons */}
          <div className="flex items-center gap-4 mt-6 text-muted-foreground/50">
            <Anchor className="w-5 h-5" />
            <Container className="w-5 h-5" />
            <Ship className="w-5 h-5" />
          </div>
        </div>
      </div>
    </div>
  );
}
