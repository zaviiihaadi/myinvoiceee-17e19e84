import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { useAuth } from '@/hooks/useAuth';
import {
  Sparkles, ArrowRight, Package, FileText, FileSpreadsheet,
  ShieldCheck, Zap, Clock, BadgeCheck,
} from 'lucide-react';

type CardDef = {
  id: 'multi' | 'single' | 'excel';
  title: string;
  desc: string;
  btn: string;
  icon: typeof Package;
  onClick: () => void;
  gradient: string;
  iconTint: string;
  btnText: string;
  glow: string;
};

const InvoiceHome = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [authLoading, user, navigate]);

  if (authLoading || !user) return <div className="min-h-screen bg-background" />;

  const cards: CardDef[] = [
    {
      id: 'multi',
      title: 'Multiple BL',
      desc: 'Upload up to 10 BL files at once and generate invoices in bulk',
      btn: 'Upload Multiple BL',
      icon: Package,
      onClick: () => navigate('/multi-bl-invoice'),
      gradient: 'from-indigo-500 via-violet-500 to-purple-600',
      iconTint: 'text-violet-600',
      btnText: 'text-violet-700',
      glow: 'shadow-[0_20px_60px_-15px_rgba(124,58,237,0.55)]',
    },
    {
      id: 'single',
      title: 'Single BL',
      desc: 'Upload a single BL file and generate invoice instantly',
      btn: 'Upload Single BL',
      icon: FileText,
      onClick: () => navigate('/invoice-generator'),
      gradient: 'from-emerald-400 via-teal-500 to-cyan-500',
      iconTint: 'text-emerald-600',
      btnText: 'text-emerald-700',
      glow: 'shadow-[0_20px_60px_-15px_rgba(16,185,129,0.55)]',
    },
    {
      id: 'excel',
      title: 'Excel Upload',
      desc: 'Upload or update your Excel file for data mapping and matching',
      btn: 'Upload Excel File',
      icon: FileSpreadsheet,
      onClick: () => navigate('/invoice-generator?upload=excel'),
      gradient: 'from-orange-400 via-amber-500 to-yellow-500',
      iconTint: 'text-emerald-600',
      btnText: 'text-orange-700',
      glow: 'shadow-[0_20px_60px_-15px_rgba(249,115,22,0.55)]',
    },
  ];

  const features = [
    { icon: ShieldCheck, title: 'Secure & Private', sub: 'Your data is safe with us', color: 'text-violet-600 bg-violet-100' },
    { icon: Zap, title: 'AI Powered', sub: 'Smart data extraction', color: 'text-emerald-600 bg-emerald-100' },
    { icon: Clock, title: 'Fast Processing', sub: 'Quick invoice generation', color: 'text-sky-600 bg-sky-100' },
    { icon: BadgeCheck, title: 'Accurate Results', sub: '99.9% accuracy rate', color: 'text-rose-600 bg-rose-100' },
  ];

  const renderCard = (card: CardDef, idx: number) => {
    const Icon = card.icon;
    return (
      <motion.button
        key={card.id}
        type="button"
        onClick={card.onClick}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 + idx * 0.1 }}
        whileHover={{ y: -6, scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className={`group relative text-left overflow-hidden rounded-3xl p-6 sm:p-8 bg-gradient-to-br ${card.gradient} ${card.glow} transition-all duration-300`}
      >
        {/* Decorative shapes */}
        <div className="pointer-events-none absolute -right-10 -bottom-10 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute right-8 top-8 opacity-20">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        <div className="pointer-events-none absolute right-20 bottom-10 opacity-10">
          <Icon className="w-32 h-32 text-white" />
        </div>
        <div className="pointer-events-none absolute right-6 bottom-6 opacity-30">
          <Sparkles className="w-4 h-4 text-white" />
        </div>

        <div className="relative flex items-start gap-4 sm:gap-5">
          <motion.div
            whileHover={{ rotate: 6, scale: 1.05 }}
            className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/95 backdrop-blur flex items-center justify-center shadow-lg"
          >
            <Icon className={`w-8 h-8 sm:w-10 sm:h-10 ${card.iconTint}`} />
          </motion.div>
          <div className="flex-1 min-w-0 text-white">
            <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-tight drop-shadow-sm">
              {card.title}
            </h3>
            <p className="mt-1.5 text-sm sm:text-base text-white/90 leading-relaxed max-w-md">
              {card.desc}
            </p>
            <div className={`mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white font-semibold text-sm sm:text-base ${card.btnText} shadow-md group-hover:gap-3 transition-all`}>
              {card.btn}
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </motion.button>
    );
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background blobs */}
      <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-violet-300/30 blur-3xl animate-blob" />
      <div className="pointer-events-none absolute top-1/3 -right-32 w-96 h-96 rounded-full bg-emerald-300/30 blur-3xl animate-blob" style={{ animationDelay: '2s' }} />
      <div className="pointer-events-none absolute bottom-0 left-1/3 w-96 h-96 rounded-full bg-amber-300/20 blur-3xl animate-blob" style={{ animationDelay: '4s' }} />

      <Header />

      <main className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8 sm:mb-12"
        >
          <div className="inline-flex items-center gap-2 mb-3">
            <Sparkles className="w-6 h-6 text-violet-500 animate-pulse-soft" />
            <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
                Welcome to BL Invoice System
              </span>
            </h1>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
            Choose an option below to get started with invoice generation
          </p>
        </motion.div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {renderCard(cards[0], 0)}
          {renderCard(cards[1], 1)}
          <div className="md:col-span-2 md:flex md:justify-center">
            <div className="w-full md:w-2/3">
              {renderCard(cards[2], 2)}
            </div>
          </div>
        </div>

        {/* Bottom feature bar */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-8 sm:mt-12 rounded-2xl bg-white/80 backdrop-blur-xl border border-white/60 shadow-lg p-4 sm:p-5"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-2">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${f.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{f.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{f.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default InvoiceHome;
