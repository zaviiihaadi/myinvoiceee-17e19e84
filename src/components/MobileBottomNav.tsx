import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, FileText, Layers, ShieldCheck, MoreHorizontal } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Ship, Globe, Sparkles, LogOut } from 'lucide-react';

const items = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/invoice-generator', label: 'Single BL', icon: FileText },
  { path: '/multi-bl-invoice', label: 'Multi BL', icon: Layers },
  { path: '/noc-tracker', label: 'NOC', icon: ShieldCheck },
];

export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  if (location.pathname === '/auth') return null;

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <>
      {/* Spacer so content isn't hidden behind the bar */}
      <div className="md:hidden h-20" aria-hidden />

      <motion.nav
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="md:hidden fixed bottom-0 inset-x-0 z-50"
      >
        <div className="mx-3 mb-3 rounded-2xl bg-white/90 backdrop-blur-xl border border-slate-200 shadow-[0_-4px_24px_-8px_rgba(15,23,42,0.15)]">
          <ul className="grid grid-cols-5 px-1.5 py-1.5">
            {items.map((it) => {
              const Icon = it.icon;
              const active =
                location.pathname === it.path ||
                (it.path === '/invoice-generator' &&
                  location.pathname.startsWith('/invoice-generator'));
              return (
                <li key={it.path}>
                  <Link
                    to={it.path}
                    className="relative flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl transition-colors"
                  >
                    {active && (
                      <motion.div
                        layoutId="mobileNavActive"
                        className="absolute inset-1 rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-200"
                        transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
                      />
                    )}
                    <Icon
                      className={`relative w-5 h-5 ${
                        active ? 'text-indigo-600' : 'text-slate-500'
                      }`}
                    />
                    <span
                      className={`relative text-[10px] font-semibold leading-none ${
                        active ? 'text-indigo-700' : 'text-slate-500'
                      }`}
                    >
                      {it.label}
                    </span>
                  </Link>
                </li>
              );
            })}

            <li>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-full flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-slate-500">
                    <MoreHorizontal className="w-5 h-5" />
                    <span className="text-[10px] font-semibold leading-none">More</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  side="top"
                  className="w-56 rounded-2xl p-2 mb-2"
                >
                  <DropdownMenuItem asChild>
                    <Link to="/" className="gap-2 rounded-lg cursor-pointer">
                      <Ship className="w-4 h-4" /> Home
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/tracking" className="gap-2 rounded-lg cursor-pointer">
                      <Globe className="w-4 h-4" /> Tracking
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/invoice-home" className="gap-2 rounded-lg cursor-pointer">
                      <Sparkles className="w-4 h-4" /> Invoice Home
                    </Link>
                  </DropdownMenuItem>
                  {user && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleSignOut}
                        className="gap-2 rounded-lg cursor-pointer text-red-600 focus:text-red-600"
                      >
                        <LogOut className="w-4 h-4" /> Sign Out
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          </ul>
        </div>
      </motion.nav>
    </>
  );
}
