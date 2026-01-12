import { Ship, Anchor, Waves, BarChart3, LogOut, User, Sparkles, Menu, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };
  
  return (
    <header className="sticky top-0 z-50 w-full">
      {/* Glassmorphism navbar */}
      <div className="bg-glass border-b border-border/50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3 group">
              <div className="relative">
                <div className="w-12 h-12 rounded-2xl bg-ocean-gradient flex items-center justify-center shadow-lg group-hover:shadow-glow transition-all duration-500 animate-float">
                  <Ship className="w-6 h-6 text-primary-foreground" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-md animate-bounce-soft">
                  <Anchor className="w-3 h-3 text-accent-foreground" />
                </div>
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold font-display text-foreground group-hover:text-gradient transition-all duration-300">
                  CargoTrack Pro
                </h1>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Waves className="w-3 h-3 text-primary" />
                  Real-time Tracking
                </p>
              </div>
            </Link>
            
            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-2 bg-muted/50 rounded-2xl p-1.5">
              <Link 
                to="/" 
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                  location.pathname === '/' 
                    ? 'bg-card text-foreground shadow-md' 
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Ship className="w-4 h-4" />
                  Tracking
                </span>
              </Link>
              <Link 
                to="/dashboard" 
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 flex items-center gap-2 ${
                  location.pathname === '/dashboard' 
                    ? 'bg-card text-foreground shadow-md' 
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                Dashboard
              </Link>
            </nav>

            {/* Right side - Status & Auth */}
            <div className="flex items-center gap-3">
              {/* Live Status Badge */}
              <div className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-2xl bg-status-arrived/10 border border-status-arrived/20">
                <div className="relative">
                  <div className="w-2.5 h-2.5 rounded-full bg-status-arrived" />
                  <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-status-arrived animate-ping opacity-75" />
                </div>
                <span className="text-sm font-medium text-status-arrived">Live</span>
              </div>

              {/* Feature Badge */}
              <div className="hidden xl:flex items-center gap-2 px-4 py-2 rounded-2xl bg-secondary">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-secondary-foreground">5+ Shipping Lines</span>
              </div>

              {/* Auth controls */}
              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="gap-2 rounded-xl border-border hover:border-primary/50 hover:bg-primary/5 transition-all duration-300"
                    >
                      <div className="w-7 h-7 rounded-lg bg-ocean-gradient flex items-center justify-center">
                        <User className="w-4 h-4 text-primary-foreground" />
                      </div>
                      <span className="hidden sm:inline max-w-[100px] truncate text-foreground">
                        {user.email?.split('@')[0]}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 rounded-xl p-2">
                    <DropdownMenuItem onClick={handleSignOut} className="gap-2 cursor-pointer rounded-lg">
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Link to="/auth">
                  <Button 
                    size="sm"
                    className="rounded-xl bg-ocean-gradient hover:opacity-90 shadow-md hover:shadow-lg transition-all duration-300 gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Get Started
                  </Button>
                </Link>
              )}

              {/* Mobile menu button */}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden rounded-xl"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
            </div>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <nav className="md:hidden mt-4 pt-4 border-t border-border/50 animate-fade-in">
              <div className="flex flex-col gap-2">
                <Link 
                  to="/" 
                  onClick={() => setMobileMenuOpen(false)}
                  className={`px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 flex items-center gap-3 ${
                    location.pathname === '/' 
                      ? 'bg-primary/10 text-primary' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  <Ship className="w-5 h-5" />
                  Tracking
                </Link>
                <Link 
                  to="/dashboard" 
                  onClick={() => setMobileMenuOpen(false)}
                  className={`px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 flex items-center gap-3 ${
                    location.pathname === '/dashboard' 
                      ? 'bg-primary/10 text-primary' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  <BarChart3 className="w-5 h-5" />
                  Dashboard
                </Link>
              </div>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
