import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, CheckCircle2, Clock, AlertTriangle, Search, PackageCheck, Trash2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
      return <Badge variant="outline">Pending Approval</Badge>;
  }
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function NocTracker() {
  const { user } = useAuth();
  const [records, setRecords] = useState<NocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [alerted, setAlerted] = useState<Set<string>>(new Set());

  // Real-time tick
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
    if (error) {
      toast.error('Failed to load NOC records');
    } else {
      setRecords((data || []) as NocRecord[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel('noc-records-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'noc_records' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  // Alerts at 7/3/1 days remaining
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
      .update({
        arrived_date: new Date().toISOString(),
        status: 'Container Arrived',
      })
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
    let total = decorated.length, active = 0, expiring = 0, expired = 0;
    decorated.forEach((r) => {
      if (r.displayStatus === 'NOC Approved') active++;
      else if (r.displayStatus === 'Expiring Soon') { expiring++; active++; }
      else if (r.displayStatus === 'Expired') expired++;
    });
    return { total, active, expiring, expired };
  }, [decorated]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-bold font-display">NOC Tracker</h1>
          </div>
          <p className="text-muted-foreground mb-6">
            Real-time 15-day NOC countdown for every generated invoice.
          </p>

          {/* Counters */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total NOCs', value: counters.total, icon: ShieldCheck, color: 'text-foreground' },
              { label: 'Active NOCs', value: counters.active, icon: CheckCircle2, color: 'text-emerald-600' },
              { label: 'Expiring Soon', value: counters.expiring, icon: Clock, color: 'text-yellow-600' },
              { label: 'Expired', value: counters.expired, icon: AlertTriangle, color: 'text-red-600' },
            ].map((c) => (
              <Card key={c.label} className="bg-card/60 backdrop-blur border-border/60">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                    <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
                  </div>
                  <c.icon className={`w-6 h-6 ${c.color}`} />
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="bg-card/60 backdrop-blur border-border/60">
            <CardHeader className="flex-row items-center justify-between gap-4 flex-wrap">
              <CardTitle className="text-lg">NOC Records</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search container / invoice / BL"
                    className="pl-8 w-64"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="All statuses" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-10 text-center text-muted-foreground">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
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
        </motion.div>
      </main>
    </div>
  );
}
