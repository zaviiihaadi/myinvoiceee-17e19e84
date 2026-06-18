import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail, Search, Loader2, FileText, CheckCircle2, Plus, X,
  Calendar, User, ArrowDownUp, Download as DownloadIcon, StopCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface GmailMatch {
  id: string;
  from: string;
  subject: string;
  date: string;
  dateMs: number;
  snippet: string;
  attachment: {
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
  };
}

interface GmailBlSearchProps {
  onAddFile: (file: File, meta: { blNumber: string; emailSubject: string; from: string }) => void;
  addButtonLabel?: string;
  title?: string;
  addDisabled?: boolean;
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!text) return null;
  if (!term.trim()) return <>{text}</>;
  const re = new RegExp(`(${escapeRegExp(term.trim())})`, 'ig');
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        re.test(p) ? (
          <mark
            key={i}
            className="bg-yellow-200/80 text-slate-900 font-semibold rounded px-0.5"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

const fmtSize = (n: number) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const fmtDate = (ms: number, fallback: string) => {
  if (!ms || !isFinite(ms)) return fallback || '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return fallback || '—';
  }
};

export function GmailBlSearch({
  onAddFile,
  addButtonLabel = 'Add BL to Processing',
  title = 'Search from Gmail',
  addDisabled = false,
}: GmailBlSearchProps) {
  const [blNumber, setBlNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<GmailMatch[]>([]);
  const [searched, setSearched] = useState(false);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const sortedMatches = useMemo(() => {
    const copy = [...matches];
    copy.sort((a, b) =>
      sortDir === 'desc' ? (b.dateMs || 0) - (a.dateMs || 0) : (a.dateMs || 0) - (b.dateMs || 0)
    );
    return copy;
  }, [matches, sortDir]);

  const runSearch = async () => {
    const q = blNumber.trim();
    if (!q) {
      toast.error('Enter a BL number to search');
      return;
    }
    // Cancel any in-flight search
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setMatches([]);
    setSearched(false);
    setSearchTerm(q);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-search-bl', {
        body: { blNumber: q },
      });
      if (controller.signal.aborted) return;
      if (error) throw error;
      setSearched(true);
      const list: GmailMatch[] = data?.matches || [];
      setMatches(list);
      if (list.length === 0) {
        toast.info('No matching email found in Gmail.');
      } else {
        toast.success(`${list.length} email${list.length === 1 ? '' : 's'} found`);
      }
    } catch (e: any) {
      if (controller.signal.aborted) return;
      console.error(e);
      toast.error(e?.message || 'Gmail search failed');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancelSearch = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    toast.message('Search cancelled');
  };

  const handleAdd = async (match: GmailMatch) => {
    if (addDisabled) return;
    setAddingId(match.id);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-search-bl', {
        body: { messageId: match.id, attachmentId: match.attachment.attachmentId },
      });
      if (error) throw error;
      const base64 = data?.base64 as string | undefined;
      if (!base64) throw new Error('Empty attachment');
      const blob = b64ToBlob(base64, match.attachment.mimeType || 'application/pdf');
      const file = new File(
        [blob],
        match.attachment.filename || `${blNumber || 'bl'}.pdf`,
        { type: match.attachment.mimeType || 'application/pdf' },
      );
      onAddFile(file, {
        blNumber: blNumber.trim(),
        emailSubject: match.subject,
        from: match.from,
      });
    } catch (e: any) {
      toast.error(e?.message || 'Could not add file');
    } finally {
      setAddingId(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-rose-100 bg-white shadow-[0_8px_30px_-12px_rgba(244,63,94,0.25)] overflow-hidden"
    >
      <div className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-rose-50 via-orange-50/60 to-white border-b border-rose-100">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white flex items-center justify-center shadow-md shadow-rose-500/30">
          <Mail className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base sm:text-lg font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">Find BL attachments straight from your inbox</p>
        </div>
        {matches.length > 1 && (
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
            title="Toggle sort by date"
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            {sortDir === 'desc' ? 'Newest' : 'Oldest'}
          </button>
        )}
      </div>

      <div className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={blNumber}
              onChange={(e) => setBlNumber(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              placeholder="Enter BL Number e.g. PGSM2030039722-01"
              className="pl-9 h-11"
              disabled={loading}
            />
          </div>
          {loading ? (
            <Button
              onClick={cancelSearch}
              variant="outline"
              className="h-11 px-5 gap-2 border-rose-200 text-rose-600 hover:bg-rose-50"
            >
              <StopCircle className="w-4 h-4" /> Cancel
            </Button>
          ) : (
            <Button
              onClick={runSearch}
              disabled={!blNumber.trim()}
              className="h-11 px-5 gap-2 bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600 text-white shadow-md"
            >
              <Search className="w-4 h-4" /> Search Gmail
            </Button>
          )}
        </div>

        {matches.length > 1 && (
          <div className="sm:hidden flex justify-end">
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
            >
              <ArrowDownUp className="w-3.5 h-3.5" />
              Sort: {sortDir === 'desc' ? 'Newest first' : 'Oldest first'}
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {loading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-xl border border-dashed border-rose-200 bg-rose-50/40 p-5 text-center"
            >
              <Loader2 className="w-6 h-6 text-rose-500 animate-spin mx-auto mb-2" />
              <p className="text-sm text-slate-600">Scanning your inbox…</p>
              <p className="text-xs text-slate-400 mt-1">Tap Cancel to stop</p>
            </motion.div>
          )}

          {!loading && sortedMatches.length > 0 && (
            <motion.div
              key="list"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                <CheckCircle2 className="w-4 h-4" />
                {sortedMatches.length} match{sortedMatches.length === 1 ? '' : 'es'} found
              </div>

              {sortedMatches.map((m) => (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/60 p-4 space-y-3 hover:border-emerald-200 hover:shadow-sm transition"
                >
                  <div className="grid sm:grid-cols-2 gap-2 text-sm">
                    <div className="flex items-start gap-2 min-w-0">
                      <User className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">Sender</p>
                        <p className="text-slate-900 truncate">{m.from || '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 min-w-0">
                      <Calendar className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">Date</p>
                        <p className="text-slate-900 truncate">{fmtDate(m.dateMs, m.date)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 min-w-0 sm:col-span-2">
                      <Mail className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">Subject</p>
                        <p className="text-slate-900 truncate">
                          <Highlight text={m.subject || '—'} term={searchTerm} />
                        </p>
                      </div>
                    </div>
                    {m.snippet && (
                      <div className="sm:col-span-2 text-xs text-slate-500 line-clamp-2 pl-6">
                        <Highlight text={m.snippet} term={searchTerm} />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="w-10 h-10 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-rose-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        <Highlight text={m.attachment.filename} term={searchTerm} />
                      </p>
                      <p className="text-xs text-slate-500">
                        {m.attachment.mimeType}
                        {m.attachment.size ? ` · ${fmtSize(m.attachment.size)}` : ''}
                      </p>
                    </div>
                    <Button
                      onClick={() => handleAdd(m)}
                      disabled={addDisabled || addingId === m.id}
                      size="sm"
                      className="gap-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
                    >
                      {addingId === m.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      {addingId === m.id ? 'Adding…' : addButtonLabel}
                    </Button>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {!loading && searched && sortedMatches.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center text-sm text-slate-500"
            >
              No email with that BL number was found.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
