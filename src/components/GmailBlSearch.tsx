import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Search, Loader2, FileText, CheckCircle2, Plus, X, Calendar, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface GmailMatch {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  attachment: {
    filename: string;
    mimeType: string;
    size: number;
    base64: string;
  };
}

interface GmailBlSearchProps {
  /** Callback receives the File built from Gmail attachment */
  onAddFile: (file: File, meta: { blNumber: string; emailSubject: string; from: string }) => void;
  /** Button label after a match is found */
  addButtonLabel?: string;
  /** Optional title override */
  title?: string;
  /** Optional disabled flag for the add button (e.g. when at max bulk count) */
  addDisabled?: boolean;
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function GmailBlSearch({
  onAddFile,
  addButtonLabel = 'Add BL to Processing',
  title = 'Search from Gmail',
  addDisabled = false,
}: GmailBlSearchProps) {
  const [blNumber, setBlNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [match, setMatch] = useState<GmailMatch | null>(null);
  const [searched, setSearched] = useState(false);

  const runSearch = async () => {
    const q = blNumber.trim();
    if (!q) {
      toast.error('Enter a BL number to search');
      return;
    }
    setLoading(true);
    setMatch(null);
    setSearched(false);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-search-bl', {
        body: { blNumber: q },
      });
      if (error) throw error;
      setSearched(true);
      if (!data?.found) {
        toast.info('No matching email found in Gmail.');
        return;
      }
      setMatch(data as GmailMatch);
      toast.success('Email found in Gmail');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Gmail search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    if (!match) return;
    try {
      const blob = b64ToBlob(match.attachment.base64, match.attachment.mimeType || 'application/pdf');
      const file = new File([blob], match.attachment.filename || `${blNumber}.pdf`, {
        type: match.attachment.mimeType || 'application/pdf',
      });
      onAddFile(file, {
        blNumber: blNumber.trim(),
        emailSubject: match.subject,
        from: match.from,
      });
      // Clear after add so they can search next
      setMatch(null);
      setBlNumber('');
      setSearched(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not add file');
    }
  };

  const fmtSize = (n: number) => {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
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
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">Find BL attachments straight from your inbox</p>
        </div>
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
          <Button
            onClick={runSearch}
            disabled={loading || !blNumber.trim()}
            className="h-11 px-5 gap-2 bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600 text-white shadow-md"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'Searching…' : 'Search Gmail'}
          </Button>
        </div>

        <AnimatePresence mode="wait">
          {loading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-xl border border-dashed border-rose-200 bg-rose-50/40 p-5 text-center"
            >
              <Loader2 className="w-6 h-6 text-rose-500 animate-spin mx-auto mb-2" />
              <p className="text-sm text-slate-600">Scanning your inbox…</p>
            </motion.div>
          )}

          {!loading && match && (
            <motion.div
              key="match"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white p-4 space-y-3"
            >
              <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                <CheckCircle2 className="w-4 h-4" /> Email Found
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-sm">
                <div className="flex items-start gap-2">
                  <User className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">Sender</p>
                    <p className="text-slate-900 truncate">{match.from || '—'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Calendar className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">Date</p>
                    <p className="text-slate-900 truncate">{match.date || '—'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 sm:col-span-2">
                  <Mail className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">Subject</p>
                    <p className="text-slate-900 truncate">{match.subject || '—'}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="w-10 h-10 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-rose-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{match.attachment.filename}</p>
                  <p className="text-xs text-slate-500">
                    {match.attachment.mimeType} {match.attachment.size ? `· ${fmtSize(match.attachment.size)}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={handleAdd}
                  disabled={addDisabled}
                  className="flex-1 gap-2 h-11 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-md"
                >
                  <Plus className="w-4 h-4" /> {addButtonLabel}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setMatch(null); setSearched(false); }}
                  className="h-11 gap-2"
                >
                  <X className="w-4 h-4" /> Discard
                </Button>
              </div>
            </motion.div>
          )}

          {!loading && !match && searched && (
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
