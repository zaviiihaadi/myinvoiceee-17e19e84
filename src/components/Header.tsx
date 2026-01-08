import { Ship, Anchor, Waves, BarChart3 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export function Header() {
  const location = useLocation();
  
  return (
    <header className="relative overflow-hidden bg-ocean-gradient py-8 px-6">
      {/* Decorative waves */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -bottom-2 left-0 right-0 h-16 opacity-20">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="w-full h-full">
            <path d="M0,60 C300,100 600,20 900,60 C1050,80 1150,40 1200,60 L1200,120 L0,120 Z" fill="currentColor" className="text-background" />
          </svg>
        </div>
      </div>
      
      <div className="container mx-auto relative z-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-4 hover:opacity-90 transition-opacity">
            <div className="relative">
              <div className="w-14 h-14 rounded-xl bg-primary-foreground/20 backdrop-blur-sm flex items-center justify-center animate-float">
                <Ship className="w-8 h-8 text-primary-foreground" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                <Anchor className="w-3 h-3 text-accent-foreground" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-primary-foreground tracking-tight">
                CargoTrack Pro
              </h1>
              <p className="text-sm text-primary-foreground/80 flex items-center gap-2">
                <Waves className="w-4 h-4" />
                Real-time Container Tracking
              </p>
            </div>
          </Link>
          
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-2">
              <Link 
                to="/" 
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === '/' 
                    ? 'bg-primary-foreground/20 text-primary-foreground' 
                    : 'text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10'
                }`}
              >
                Tracking
              </Link>
              <Link 
                to="/dashboard" 
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  location.pathname === '/dashboard' 
                    ? 'bg-primary-foreground/20 text-primary-foreground' 
                    : 'text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                Dashboard
              </Link>
            </nav>
            
            <div className="hidden lg:flex items-center gap-6 text-primary-foreground/90 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-status-arrived animate-pulse" />
                <span>Live Tracking</span>
              </div>
              <div className="px-4 py-2 rounded-lg bg-primary-foreground/10 backdrop-blur-sm">
                <span className="font-medium">5+ Shipping Lines</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
