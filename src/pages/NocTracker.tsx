import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck, CheckCircle2, Clock, AlertTriangle, Search,
  PackageCheck, Trash2, FileText, BarChart3, Filter, Bell, Menu,
  TrendingUp, XCircle,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface NocRecord {
  id: string;
  user_id: string;
  container_number: string;
  bl_number: string | null;
  invoice_number: string | null;
  generated_date: string;
  status: string;
  approval_date: string | null;
  expiry_date: string | null;
  arrived_date: string | null;
}

const STATUSES = [
  'Pending Approval',
  'NOC Approved',
  'Expiring Soon',
  'Expired',
  'Container Arrived',
];

const DAY_MS = 24 * 60 * 60 * 1000;

function computeDisplayStatus(r: NocRecord, now: number) {
  if (r.status === 'Container Arrived' || r.arrived_date) return 'Container Arrived';
  if (!r.approval_date || !r.expiry_date) return 'Pending Approval';
  const expiry = new Date(r.expiry_date).getTime();
  const daysLeft = Math.ceil((expiry - now) / DAY_MS);
  if (daysLeft <= 0) return 'Expired';
  if (daysLeft <= 3) return 'Expiring Soon';
  return 'NOC Approved';
}

function statusBadge(status: string) {
  switch (status) {
    case 'NOC Approved':
      return <Badge className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20">Active</Badge>;
    case 'Expiring Soon':
      return <Badge className="bg-yellow-500/15 text-yellow-600 border border-yellow-500/30 hover:bg-yellow-500/20">Expiring Soon</Badge>;
    case 'Expired':
      return <Badge className="bg-red-500/15 text-red-600 border border-red-500/30 hover:bg-red-500/20">Expired</Badge>;
    case 'Container Arrived':
      return <Badge className="bg-blue-500/15 text-blue-600 border border-blue-500/30 hover:bg-blue-500/20">Container Arrived</Badge>;
    default:
      return <Badge className="bg-amber-500/15 text-amber-600 border border-amber-500/30">Pending Approval</Badge>;
  }
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* --- Donut chart (SVG) --- */
function DonutChart({
  segments, total,
}: {
  segments: { value: number; color: string }[];
  total: number;
}) {
  const size = 160;
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  let offset = 0;
  const safeTotal = total || 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={stroke} />
      {segments.map((s, i) => {
        const len = (s.value / safeTotal) * circ;
        const el = (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${circ}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
          />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}

function StatCard({
  icon: Icon, label, value, sub, tone,
}: {
  icon: any; label: string; value: number | string; sub: string;
  tone: 'indigo' | 'emerald' | 'amber' | 'sky' | 'red' | 'orange';
}) {
  const tones: Record<string, { bg: string; text: string }> = {
    indigo: { bg: 'bg-indigo-100', text: 'text-indigo-600' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600' },
    amber: { bg: 'bg-amber-100', text: 'text-amber-600' },
    sky: { bg: 'bg-sky-100', text: 'text-sky-600' },
    red: { bg: 'bg-red-100', text: 'text-red-500' },
    orange: { bg: 'bg-orange-100', text: 'text-orange-500' },
  };
  const t = tones[tone];
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className={`w-9 h-9 rounded-xl ${t.bg} ${t.text} flex items-center justify-center mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-0.5 leading-tight">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </motion.div>
  );
}

export default function NocTracker() {
  const { user } = useAuth();
  const [records, setRecords] = useState<NocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [alerted, setAlerted] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('noc_records')
      .select('*')
      .order('generated_date', { ascending: false });
    if (error) toast.error('Failed to load NOC records');
    else setRecords((data || []) as NocRecord[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel('noc-records-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'noc_records' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  useEffect(() => {
    records.forEach((r) => {
      if (!r.approval_date || !r.expiry_date || r.arrived_date) return;
      const daysLeft = Math.ceil((new Date(r.expiry_date).getTime() - now) / DAY_MS);
      [7, 3, 1].forEach((d) => {
        if (daysLeft === d) {
          const key = `${r.id}:${d}`;
          if (!alerted.has(key)) {
            toast.warning(`${r.container_number}: ${d} day${d > 1 ? 's' : ''} remaining for NOC expiry`);
            setAlerted((prev) => new Set(prev).add(key));
          }
        }
      });
    });
  }, [now, records]);

  const approve = async (id: string) => {
    const approval = new Date();
    const expiry = new Date(approval.getTime() + 15 * DAY_MS);
    const { error } = await supabase
      .from('noc_records')
      .update({
        approval_date: approval.toISOString(),
        expiry_date: expiry.toISOString(),
        status: 'NOC Approved',
      })
      .eq('id', id);
    if (error) toast.error('Failed to approve');
    else { toast.success('NOC Approved — 15-day countdown started'); load(); }
  };

  const markArrived = async (id: string) => {
    const { error } = await supabase
      .from('noc_records')
      .update({ arrived_date: new Date().toISOString(), status: 'Container Arrived' })
      .eq('id', id);
    if (error) toast.error('Failed to update');
    else { toast.success('Marked as Container Arrived'); load(); }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('noc_records').delete().eq('id', id);
    if (error) toast.error('Failed to delete');
    else { toast.success('Record deleted'); load(); }
  };

  const decorated = useMemo(() => records.map((r) => {
    const displayStatus = computeDisplayStatus(r, now);
    const daysRemaining = r.expiry_date && !r.arrived_date
      ? Math.max(0, Math.ceil((new Date(r.expiry_date).getTime() - now) / DAY_MS))
      : null;
    return { ...r, displayStatus, daysRemaining };
  }), [records, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return decorated.filter((r) => {
      if (statusFilter !== 'all' && r.displayStatus !== statusFilter) return false;
      if (!q) return true;
      return [r.container_number, r.invoice_number, r.bl_number]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [decorated, search, statusFilter]);

  const counters = useMemo(() => {
    let total = decorated.length, active = 0, pending = 0, completed = 0, expiring = 0, expired = 0, failed = 0;
    decorated.forEach((r) => {
      if (r.displayStatus === 'NOC Approved') { active++; }
      else if (r.displayStatus === 'Expiring Soon') { expiring++; active++; }
      else if (r.displayStatus === 'Expired') expired++;
      else if (r.displayStatus === 'Container Arrived') completed++;
      else if (r.displayStatus === 'Pending Approval') pending++;
    });
    return { total, active, pending, completed, expiring, expired, failed };
  }, [decorated]);

  const segments = [
    { value: counters.active, color: '#34d399' }, // emerald
    { value: counters.pending, color: '#fbbf24' }, // amber
    { value: counters.completed, color: '#60a5fa' }, // sky
    { value: counters.expired, color: '#f87171' }, // red
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 pb-24 md:pb-8">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {/* Mobile-style header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center md:hidden">
              <Menu className="w-5 h-5 text-slate-600" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">NOC Tracker</h1>
                <p className="text-xs text-slate-500">Real-time NOC monitoring</p>
              </div>
            </div>
          </div>
          <button className="relative w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center">
            <Bell className="w-5 h-5 text-slate-600" />
            {counters.expiring > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {counters.expiring}
              </span>
            )}
          </button>
        </div>

        {/* NOC Overview gradient hero card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl bg-gradient-to-br from-indigo-500 via-violet-600 to-purple-700 text-white p-5 sm:p-6 shadow-xl shadow-violet-500/30 relative overflow-hidden mb-5"
        >
          <div className="absolute -top-16 -right-16 w-60 h-60 rounded-full bg-white/10 blur-3xl pointer-events-none" />
          <div className="flex items-center justify-between mb-4 relative">
            <div>
              <h2 className="text-lg font-bold">NOC Overview</h2>
              <p className="text-xs text-white/70 mt-0.5">Live Status</p>
            </div>
            <button className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 border border-white/20 backdrop-blur transition">
              View Report
            </button>
          </div>
          <div className="grid grid-cols-[auto,1fr] gap-5 items-center relative">
            <div className="relative">
              <DonutChart segments={segments} total={counters.total} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-3xl font-bold leading-none">{counters.total}</p>
                <p className="text-[10px] text-white/70 mt-1">Total NOCs</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {[
                { color: '#34d399', label: 'Active', value: counters.active },
                { color: '#fbbf24', label: 'Pending', value: counters.pending },
                { color: '#60a5fa', label: 'Completed', value: counters.completed },
                { color: '#f87171', label: 'Expired', value: counters.expired },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-sm text-white/90 font-medium">{s.value} {s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-5">
          <StatCard icon={FileText} label="Total NOCs" value={counters.total} sub="All Time" tone="indigo" />
          <StatCard icon={ShieldCheck} label="Active" value={counters.active} sub="Currently" tone="emerald" />
          <StatCard icon={Clock} label="Pending" value={counters.pending} sub="Processing" tone="amber" />
          <StatCard icon={CheckCircle2} label="Completed" value={counters.completed} sub="Done" tone="sky" />
          <StatCard icon={TrendingUp} label="Expiring Soon" value={counters.expiring} sub="Within 3 days" tone="orange" />
          <StatCard icon={AlertTriangle} label="Expired" value={counters.expired} sub="Already expired" tone="red" />
        </div>

        {/* Search & Filter */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search container / invoice / BL"
              className="pl-9 h-11 rounded-2xl border-slate-200 bg-white"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-11 h-11 rounded-2xl border-slate-200 bg-white p-0 flex items-center justify-center">
              <Filter className="w-4 h-4 text-slate-500" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Recent NOC Records (mobile cards) */}
        <div className="md:hidden">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-slate-800">Recent NOC Records</h3>
            <button className="text-xs font-semibold text-indigo-600">View All</button>
          </div>
          {loading ? (
            <div className="py-10 text-center text-slate-400 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm rounded-2xl border border-dashed border-slate-200 bg-white">
              No NOC records yet. Generate an invoice to create one automatically.
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.slice(0, 50).map((r, idx) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                  className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">
                      {idx + 1}
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {r.invoice_number || r.container_number}.pdf
                      </p>
                      <p className="text-xs text-slate-400 truncate">{r.container_number}</p>
                      {r.invoice_number && (
                        <p className="text-xs font-mono text-indigo-600 mt-0.5">{r.invoice_number}</p>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-emerald-600">
                          {r.daysRemaining !== null ? `${r.daysRemaining}d left` : '—'}
                        </span>
                        {statusBadge(r.displayStatus)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    {!r.approval_date && !r.arrived_date && (
                      <button
                        onClick={() => approve(r.id)}
                        className="flex-1 h-9 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </button>
                    )}
                    {!r.arrived_date && (
                      <button
                        onClick={() => markArrived(r.id)}
                        className="flex-1 h-9 rounded-lg bg-sky-50 text-sky-600 hover:bg-sky-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                      >
                        <PackageCheck className="w-3.5 h-3.5" /> Arrived
                      </button>
                    )}
                    <button
                      onClick={() => remove(r.id)}
                      className="w-9 h-9 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Desktop table */}
        <Card className="hidden md:block bg-white border border-slate-200 rounded-2xl shadow-sm">
          <CardContent className="p-0">
            {loading ? (
              <div className="py-10 text-center text-slate-400">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                No NOC records yet. Generate an invoice to create one automatically.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Container</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>BL #</TableHead>
                      <TableHead>Approval</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Days Left</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono font-medium">{r.container_number}</TableCell>
                        <TableCell>{r.invoice_number || '—'}</TableCell>
                        <TableCell>{r.bl_number || '—'}</TableCell>
                        <TableCell>{fmtDate(r.approval_date)}</TableCell>
                        <TableCell>{fmtDate(r.expiry_date)}</TableCell>
                        <TableCell>
                          {r.arrived_date ? '—' : r.daysRemaining === null ? '—' : (
                            <span className={
                              r.daysRemaining === 0 ? 'text-red-600 font-semibold'
                              : r.daysRemaining <= 3 ? 'text-yellow-600 font-semibold'
                              : 'text-emerald-600 font-semibold'
                            }>{r.daysRemaining} day{r.daysRemaining === 1 ? '' : 's'}</span>
                          )}
                        </TableCell>
                        <TableCell>{statusBadge(r.displayStatus)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {!r.approval_date && !r.arrived_date && (
                              <Button size="sm" onClick={() => approve(r.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                <CheckCircle2 className="w-4 h-4" /> NOC Approved
                              </Button>
                            )}
                            {!r.arrived_date && (
                              <Button size="sm" variant="outline" onClick={() => markArrived(r.id)}>
                                <PackageCheck className="w-4 h-4" /> Container Arrived
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
