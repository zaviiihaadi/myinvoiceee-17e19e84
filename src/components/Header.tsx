import { Ship, BarChart3, LogOut, User, Sparkles, Menu, X, Globe, Waves, ShieldCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

  const navItems = [
    { path: '/', label: 'Home', icon: Ship },
    { path: '/tracking', label: 'Tracking', icon: Globe },
    { path: '/dashboard', label: 'Dashboard', icon: BarChart3 },
    { path: '/invoice-generator', label: 'Invoice', icon: Sparkles },
    { path: '/noc-tracker', label: 'NOC', icon: ShieldCheck },
  ];
  
  return (
    <motion.header 
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="sticky top-0 z-50 w-full"
    >
      {/* Glassmorphism navbar with gradient border */}
      <div className="relative">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="bg-background/80 backdrop-blur-xl border-b border-border/40">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              {/* Logo with wave animation */}
              <Link to="/" className="flex items-center gap-3 group">
                <motion.div 
                  whileHover={{ rotate: [0, -10, 10, 0] }}
                  transition={{ duration: 0.5 }}
                  className="relative"
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary via-primary to-accent flex items-center justify-center shadow-lg shadow-primary/25">
                    <Waves className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <motion.div 
                    className="absolute -inset-1 rounded-xl bg-gradient-to-r from-primary to-accent opacity-0 blur-lg group-hover:opacity-30 transition-opacity"
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                </motion.div>
                <div className="flex flex-col">
                  <h1 className="text-xl font-bold font-display tracking-tight">
                    <span className="text-foreground">Ship</span>
                    <span className="text-gradient">Ahead</span>
                  </h1>
                  <span className="text-[10px] text-muted-foreground font-medium -mt-0.5">Container Tracking</span>
                </div>
              </Link>
              
              {/* Desktop Navigation - Pill style */}
              <nav className="hidden md:flex items-center">
                <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-2xl backdrop-blur-sm">
                  {navItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    const Icon = item.icon;
                    return (
                      <Link key={item.path} to={item.path}>
                        <motion.div
                          className={`relative px-4 py-2 rounded-xl text-sm font-medium transition-colors duration-200 flex items-center gap-2 ${
                            isActive 
                              ? 'text-primary-foreground' 
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="activeNav"
                              className="absolute inset-0 bg-gradient-to-r from-primary to-primary/80 rounded-xl shadow-md"
                              transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
                            />
                          )}
                          <span className="relative z-10 flex items-center gap-2">
                            <Icon className="w-4 h-4" />
                            {item.label}
                          </span>
                        </motion.div>
                      </Link>
                    );
                  })}
                </div>
              </nav>

              {/* Right side - Status & Auth */}
              <div className="flex items-center gap-2">
                {/* Live Status Badge */}
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-status-arrived/10 border border-status-arrived/20"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-arrived opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-status-arrived" />
                  </span>
                  <span className="text-xs font-semibold text-status-arrived">Live</span>
                </motion.div>

                {/* Auth controls */}
                {user ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="gap-2 rounded-xl hover:bg-muted/80 transition-all duration-300"
                        >
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                            <User className="w-3.5 h-3.5 text-primary-foreground" />
                          </div>
                          <span className="hidden sm:inline max-w-[100px] truncate text-foreground font-medium text-sm">
                            {user.email?.split('@')[0]}
                          </span>
                        </Button>
                      </motion.div>
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
                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                      <Button 
                        size="sm"
                        className="rounded-xl bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 shadow-md hover:shadow-lg transition-all duration-300 gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        Get Started
                      </Button>
                    </motion.div>
                  </Link>
                )}

                {/* Mobile menu button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden rounded-xl"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={mobileMenuOpen ? 'close' : 'menu'}
                      initial={{ rotate: -90, opacity: 0 }}
                      animate={{ rotate: 0, opacity: 1 }}
                      exit={{ rotate: 90, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </motion.div>
                  </AnimatePresence>
                </Button>
              </div>
            </div>

            {/* Mobile Navigation */}
            <AnimatePresence>
              {mobileMenuOpen && (
                <motion.nav 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="md:hidden overflow-hidden"
                >
                  <div className="pt-4 pb-2 space-y-1">
                    {navItems.map((item, index) => {
                      const isActive = location.pathname === item.path;
                      const Icon = item.icon;
                      return (
                        <motion.div
                          key={item.path}
                          initial={{ x: -20, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          transition={{ delay: index * 0.1 }}
                        >
                          <Link 
                            to={item.path} 
                            onClick={() => setMobileMenuOpen(false)}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                              isActive 
                                ? 'bg-primary/10 text-primary' 
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            }`}
                          >
                            <Icon className="w-5 h-5" />
                            {item.label}
                          </Link>
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.nav>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.header>
  );
}
