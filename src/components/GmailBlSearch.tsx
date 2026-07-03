import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Loader2, FileText, CheckCircle2, Plus, X,
  Calendar, User, Mail, StopCircle, UploadCloud, Sparkles, ChevronDown,
  SlidersHorizontal, ArrowDownUp, Image as ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface GmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}
interface GmailMatch {
  id: string;
  from: string;
  subject: string;
  date: string;
  dateMs: number;
  snippet: string;
  attachment: GmailAttachment;
  attachments?: GmailAttachment[];
}

interface GmailBlSearchProps {
  onAddFile: (file: File, meta: { blNumber: string; emailSubject: string; from: string }) => void;
  addButtonLabel?: string;
  title?: string;
  addDisabled?: boolean;
  /** When true, uploading an image auto-detects ALL BL/Container numbers,
   *  searches Gmail for each, and automatically adds every match to the list. */
  autoAddOnImageSearch?: boolean;
  /** Fired after the image-based batch finishes, with lists of found / missing numbers. */
  onImageSearchComplete?: (result: { found: string[]; missing: string[] }) => void;
}

const ACCEPTED_IMG = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!text) return null;
  const clean = terms.filter((t) => t && t.trim());
  if (clean.length === 0) return <>{text}</>;
  const re = new RegExp(`(${clean.map((t) => escapeRegExp(t.trim())).join('|')})`, 'ig');
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        re.test(p) ? (
          <mark
            key={i}
            className="bg-gradient-to-r from-violet-200 to-fuchsia-200 text-violet-900 font-semibold rounded px-0.5"
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
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  } catch {
    return fallback || '—';
  }
};

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const extFromMime = (m: string) => {
  if (/pdf/i.test(m)) return 'PDF';
  if (/png/i.test(m)) return 'PNG';
  if (/jpe?g/i.test(m)) return 'JPG';
  return (m.split('/')[1] || 'FILE').toUpperCase();
};

const extColor = (m: string) => {
  if (/pdf/i.test(m)) return 'from-rose-500 to-red-500';
  if (/png/i.test(m)) return 'from-sky-500 to-blue-500';
  if (/jpe?g/i.test(m)) return 'from-emerald-500 to-teal-500';
  return 'from-slate-500 to-slate-600';
};

export function GmailBlSearch({
  onAddFile,
  addButtonLabel = 'Add to List',
  title = 'Search from Gmail',
  addDisabled = false,
  autoAddOnImageSearch = false,
  onImageSearchComplete,
}: GmailBlSearchProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [matches, setMatches] = useState<GmailMatch[]>([]);
  const [searched, setSearched] = useState(false);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searchedTerms, setSearchedTerms] = useState<string[]>([]);
  const [matchedVia, setMatchedVia] = useState<'bl' | 'container' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const sortedMatches = useMemo(() => {
    const copy = [...matches];
    copy.sort((a, b) =>
      sortDir === 'desc' ? (b.dateMs || 0) - (a.dateMs || 0) : (a.dateMs || 0) - (b.dateMs || 0)
    );
    return copy;
  }, [matches, sortDir]);

  const runOne = async (q: string): Promise<GmailMatch[]> => {
    const { data, error } = await supabase.functions.invoke('gmail-search-bl', {
      body: { blNumber: q },
    });
    if (error) throw error;
    return (data?.matches as GmailMatch[]) || [];
  };

  const runSearch = async (override?: { bl?: string; container?: string }) => {
    const blQ = (override?.bl ?? query).trim();
    const containerQ = (override?.container ?? '').trim();
    if (!blQ && !containerQ) {
      toast.error('Enter a BL number or container number to search');
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setMatches([]);
    setSearched(false);
    setMatchedVia(null);
    const terms = [blQ, containerQ].filter(Boolean);
    setSearchedTerms(terms);

    try {
      let list: GmailMatch[] = [];
      let via: 'bl' | 'container' | null = null;

      if (blQ) {
        list = await runOne(blQ);
        if (controller.signal.aborted) return;
        if (list.length > 0) via = 'bl';
      }

      if (list.length === 0 && containerQ) {
        list = await runOne(containerQ);
        if (controller.signal.aborted) return;
        if (list.length > 0) via = 'container';
      }

      setSearched(true);
      setMatches(list);
      setMatchedVia(via);
      if (list.length === 0) {
        toast.info('No matching emails found in Gmail.');
      } else {
        toast.success(
          `${list.length} email${list.length === 1 ? '' : 's'} found${via === 'container' ? ' (matched by container)' : ''}`
        );
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

  const fetchAttachmentFile = async (
    match: GmailMatch,
    att: GmailAttachment,
  ): Promise<File | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('gmail-search-bl', {
        body: { messageId: match.id, attachmentId: att.attachmentId },
      });
      if (error) throw error;
      const base64 = data?.base64 as string | undefined;
      if (!base64) return null;
      const blob = b64ToBlob(base64, att.mimeType || 'application/pdf');
      return new File([blob], att.filename || 'bl.pdf', {
        type: att.mimeType || 'application/pdf',
      });
    } catch {
      return null;
    }
  };

  // Client-side detection helpers — catch anything the AI missed.
  const CONTAINER_RE = /\b([A-Z]{4}\s?\d{6,7})\b/g;
  // Broad BL/Invoice pattern: uppercase alnum tokens with optional -/ separators,
  // length 6-24, containing at least one digit. Filters out plain words.
  const BL_RE = /\b([A-Z0-9]{2,}(?:[-/][A-Z0-9]+){0,4})\b/g;
  const STOPWORDS = new Set([
    'BILL','LADING','SHIPPER','CONSIGNEE','NOTIFY','PARTY','PORT','LOADING',
    'DISCHARGE','DESTINATION','VESSEL','VOYAGE','CONTAINER','SEAL','NUMBER',
    'DATE','GROSS','WEIGHT','KGS','BALES','PACKAGES','PKGS','MARKS','DESCRIPTION',
    'GOODS','FREIGHT','PREPAID','COLLECT','ORIGINAL','COPY','TOTAL','HS','CODE',
    'PIECES','CBM','M3','KG','LBS','USD','EUR','FCL','LCL','HC','GP','REEFER',
    'YES','NO','NIL','NA','TBD','ETA','ETD','ATA','ATD',
  ]);
  const normKey = (s: string) =>
    s.toUpperCase().replace(/\s+/g, '').replace(/[\s\-_.,:;#'"/]/g, '');
  const isLikelyContainer = (s: string) => /^[A-Z]{4}\d{6,7}$/.test(s.replace(/\s+/g, '').toUpperCase());
  const isLikelyBL = (s: string) => {
    const up = s.toUpperCase();
    if (STOPWORDS.has(up.replace(/[-/].*/, ''))) return false;
    if (up.length < 6 || up.length > 24) return false;
    if (!/\d/.test(up)) return false;
    if (/^[A-Z]{4}\d{6,7}$/.test(up.replace(/\s+/g, ''))) return false; // that's a container
    if (/^\d+$/.test(up)) return false;
    return true;
  };

  const handleImageExtract = async (file: File) => {
    if (!ACCEPTED_IMG.includes(file.type)) {
      toast.error('Upload a PDF, JPG, JPEG, or PNG');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File must be under 10 MB');
      return;
    }
    setExtracting(true);
    try {
      const base64 = await readBase64(file);
      const { data, error } = await supabase.functions.invoke('extract-bl-data', {
        body: { fileBase64: base64, mimeType: file.type },
      });
      if (error) throw error;

      // 1) Collect from AI structured fields
      const aiBl = (data?.bl_number || '').toString().trim();
      const aiAllBls: string[] = Array.isArray(data?.all_bl_numbers) ? data.all_bl_numbers : [];
      const aiContainers: string[] = Array.isArray(data?.container_numbers) ? data.container_numbers : [];
      const aiAllContainers: string[] = Array.isArray(data?.all_container_numbers) ? data.all_container_numbers : [];
      const rawText = (data?.raw_text || '').toString();

      // 2) Client-side regex on raw_text as a safety net
      const regexContainers: string[] = [];
      const regexBls: string[] = [];
      if (rawText) {
        const c = rawText.match(CONTAINER_RE) || [];
        c.forEach((m) => regexContainers.push(m.replace(/\s+/g, '').toUpperCase()));
        const b = rawText.match(BL_RE) || [];
        b.forEach((m) => { if (isLikelyBL(m)) regexBls.push(m.toUpperCase()); });
      }

      // 3) Merge + classify + dedupe
      const containerSet = new Map<string, string>();
      const blSet = new Map<string, string>();
      const addContainer = (s: string) => {
        const t = (s || '').toString().trim();
        if (!t) return;
        const norm = t.replace(/\s+/g, '').toUpperCase();
        if (!isLikelyContainer(norm)) return;
        const k = normKey(norm);
        if (!containerSet.has(k)) containerSet.set(k, norm);
      };
      const addBl = (s: string) => {
        const t = (s || '').toString().trim();
        if (!t) return;
        if (isLikelyContainer(t)) { addContainer(t); return; }
        if (!isLikelyBL(t)) return;
        const k = normKey(t);
        if (!blSet.has(k)) blSet.set(k, t);
      };
      [...aiContainers, ...aiAllContainers, ...regexContainers].forEach(addContainer);
      [aiBl, ...aiAllBls, ...regexBls].forEach(addBl);

      const bls = Array.from(blSet.values());
      const containers = Array.from(containerSet.values());
      const containerFirst = containers[0] || '';
      const firstBl = bls[0] || '';

      if (bls.length === 0 && containers.length === 0) {
        toast.error('Could not detect any BL or container number');
        return;
      }

      // Non-auto mode (Single BL): keep existing single-search behaviour.
      if (!autoAddOnImageSearch) {
        setQuery(firstBl || containerFirst);
        toast.success(
          `Detected ${firstBl ? `BL: ${firstBl}` : ''}${firstBl && containerFirst ? ' · ' : ''}${containerFirst ? `Container: ${containerFirst}` : ''}`,
        );
        await runSearch({ bl: firstBl, container: containerFirst });
        return;
      }

      // AUTO MODE (Multi BL): search each detected number one-by-one; prefer BL, fallback to container.
      // Build a de-duplicated ordered list: BLs first, then containers.
      const orderedRaw = [...bls, ...containers];
      const seen = new Set<string>();
      const unique = orderedRaw.filter((n) => {
        const k = normKey(n);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      toast.success(
        `✓ Detected ${bls.length} BL${bls.length === 1 ? '' : 's'} · ${containers.length} container${containers.length === 1 ? '' : 's'} — searching Gmail…`,
      );
      setLoading(true);
      setSearchedTerms(unique);

      const found: string[] = [];
      const missing: string[] = [];
      const addedKeys = new Set<string>();
      const searchedKeys = new Set<string>(); // prevent duplicate Gmail searches

      let idx = 0;
      for (const num of unique) {
        idx += 1;
        const k = normKey(num);
        if (searchedKeys.has(k)) continue;
        searchedKeys.add(k);
        try {
          toast.message(`🔎 Searching Gmail ${idx}/${unique.length}: ${num}`);
          const list = await runOne(num);
          if (list.length === 0) {
            // If this was a BL that missed, and we have containers for the same
            // document, try the first container as a fallback for this iteration.
            missing.push(num);
            continue;
          }
          const sorted = [...list].sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
          let addedForThis = false;
          for (const m of sorted) {
            const atts = m.attachments && m.attachments.length > 0 ? m.attachments : [m.attachment];
            const att = atts.find((a) => !!a?.attachmentId);
            if (!att) continue;
            const key = `${m.id}::${att.attachmentId}`;
            if (addedKeys.has(key)) { addedForThis = true; break; }
            const f = await fetchAttachmentFile(m, att);
            if (!f) continue;
            addedKeys.add(key);
            onAddFile(f, { blNumber: num, emailSubject: m.subject, from: m.from });
            addedForThis = true;
            toast.success(`✓ Added attachment for ${num}`);
            break;
          }
          if (addedForThis) found.push(num);
          else missing.push(num);
        } catch (e) {
          missing.push(num);
        }
      }

      setLoading(false);
      setSearched(true);
      if (found.length > 0) {
        toast.success(`✅ Found ${found.length} / ${unique.length} matching PDF${found.length === 1 ? '' : 's'}`);
      } else {
        toast.error('No matching attachments found for the detected numbers');
      }
      onImageSearchComplete?.({ found, missing });
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Extraction failed');
    } finally {
      setExtracting(false);
      setLoading(false);
    }
  };



  const handleAdd = async (match: GmailMatch, att?: GmailAttachment) => {
    if (addDisabled) return;
    const attachment = att || match.attachment;
    if (!attachment?.attachmentId) {
      toast.error('Attachment is missing');
      return;
    }
    const key = `${match.id}::${attachment.attachmentId}`;
    setAddingId(key);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-search-bl', {
        body: { messageId: match.id, attachmentId: attachment.attachmentId },
      });
      if (error) throw error;
      const base64 = data?.base64 as string | undefined;
      if (!base64) throw new Error('Empty attachment');
      const blob = b64ToBlob(base64, attachment.mimeType || 'application/pdf');
      const file = new File(
        [blob],
        attachment.filename || `${query || 'bl'}.pdf`,
        { type: attachment.mimeType || 'application/pdf' },
      );
      onAddFile(file, {
        blNumber: query.trim(),
        emailSubject: match.subject,
        from: match.from,
      });
      toast.success(`Added "${attachment.filename}"`);
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
      className="relative rounded-3xl border border-violet-100 bg-gradient-to-br from-white via-violet-50/30 to-blue-50/40 shadow-[0_20px_60px_-20px_rgba(139,92,246,0.35)] overflow-hidden"
    >
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-16 -left-16 w-56 h-56 rounded-full bg-gradient-to-br from-violet-300/30 to-fuchsia-300/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -right-16 w-72 h-72 rounded-full bg-gradient-to-br from-blue-300/30 to-cyan-300/20 blur-3xl" />

      {/* Header */}
      <div className="relative px-5 sm:px-7 pt-6 pb-5">
        <div className="flex items-start gap-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            className="relative shrink-0"
          >
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-400 via-fuchsia-400 to-pink-400 blur-md opacity-60 animate-pulse" />
            <div className="relative w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-full bg-white border-[3px] border-white shadow-xl flex items-center justify-center ring-2 ring-violet-200/60">
              <svg viewBox="0 0 24 24" className="w-9 h-9 sm:w-10 sm:h-10" aria-hidden>
                <path d="M2 6.5A2.5 2.5 0 0 1 4.5 4h.5l7 5.25L19 4h.5A2.5 2.5 0 0 1 22 6.5v11A2.5 2.5 0 0 1 19.5 20H18V9.2l-6 4.5-6-4.5V20H4.5A2.5 2.5 0 0 1 2 17.5v-11Z" fill="#EA4335"/>
                <path d="M2 6.5C2 5.67 2.4 4.94 3 4.5L12 11l9-6.5c.6.44 1 1.17 1 2v.2L12 13 2 6.7v-.2Z" fill="#FBBC04"/>
                <path d="M18 9.2V20h1.5A2.5 2.5 0 0 0 22 17.5v-11c0-.13-.01-.26-.03-.39L18 9.2Z" fill="#34A853"/>
                <path d="M6 9.2 2.03 6.11A2.5 2.5 0 0 0 2 6.5v11A2.5 2.5 0 0 0 4.5 20H6V9.2Z" fill="#4285F4"/>
              </svg>
            </div>
            <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-violet-500 drop-shadow" />
          </motion.div>

          <div className="flex-1 min-w-0">
            <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">
              {title}
            </h3>
            <p className="text-sm text-slate-500 mt-1 max-w-xs">
              Find BL attachments directly from your inbox
            </p>
          </div>

          {/* Envelope graphic - desktop only */}
          <div className="hidden sm:flex relative w-24 h-24 shrink-0 items-center justify-center">
            <motion.div
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="relative w-20 h-20"
            >
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 shadow-lg shadow-violet-500/40" />
              <div className="absolute top-1 left-1.5 right-1.5 bottom-3 rounded-lg bg-white shadow-sm" />
              <div className="absolute inset-x-3 top-3 h-1.5 bg-violet-200 rounded-full" />
              <div className="absolute inset-x-3 top-6 h-1.5 w-10 bg-violet-100 rounded-full" />
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white shadow-md flex items-center justify-center">
                <Search className="w-3.5 h-3.5 text-violet-600" />
              </div>
            </motion.div>
            <Sparkles className="absolute top-0 right-0 w-3 h-3 text-fuchsia-400" />
            <div className="absolute bottom-1 left-1 w-2 h-2 rounded-full bg-violet-300/70" />
          </div>
        </div>
      </div>

      <div className="relative px-5 sm:px-7 pb-6 space-y-5">
        {/* Search input */}
        <div className="rounded-2xl bg-white/70 backdrop-blur-sm border border-violet-100 shadow-sm p-2">
          <div className="relative">
            <Search className="w-5 h-5 text-violet-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              placeholder="Search BL Number or Container Number"
              className="pl-12 pr-12 h-12 bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-base font-medium placeholder:text-slate-400"
              disabled={loading || extracting}
            />
            {query && !loading && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition"
                aria-label="Clear"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Big gradient search / cancel button */}
        {loading ? (
          <Button
            onClick={cancelSearch}
            variant="outline"
            className="w-full h-14 rounded-2xl gap-2 text-base font-bold border-rose-200 text-rose-600 hover:bg-rose-50"
          >
            <StopCircle className="w-5 h-5" /> Cancel Search
          </Button>
        ) : (
          <motion.div whileTap={{ scale: 0.985 }}>
            <Button
              onClick={() => runSearch()}
              disabled={!query.trim() || extracting}
              className="relative w-full h-14 rounded-2xl gap-2.5 text-base font-bold text-white shadow-[0_12px_30px_-10px_rgba(139,92,246,0.6)] bg-[linear-gradient(95deg,#7C3AED_0%,#C026D3_45%,#3B82F6_100%)] hover:opacity-95 overflow-hidden"
            >
              <span className="absolute inset-y-0 right-3 flex items-center opacity-80">
                <Sparkles className="w-4 h-4" />
              </span>
              <Search className="w-5 h-5" />
              Search Gmail
            </Button>
          </motion.div>
        )}

        {/* Sort chip */}
        {matches.length > 1 && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-violet-100 text-sm font-semibold text-slate-700 shadow-sm hover:shadow transition"
            >
              <ArrowDownUp className="w-4 h-4 text-violet-600" />
              Sort: {sortDir === 'desc' ? 'Newest first' : 'Oldest first'}
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        )}

        {/* Optional image upload zone */}
        <div
          onClick={() => !extracting && !loading && imgInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleImageExtract(f);
          }}
          className={`relative cursor-pointer rounded-2xl border-2 border-dashed transition-all px-5 py-6 text-center bg-white/60 backdrop-blur-sm overflow-hidden ${
            dragOver ? 'border-violet-500 bg-violet-50/70' : 'border-violet-200 hover:border-violet-400 hover:bg-white/80'
          }`}
        >
          {/* Floating decorative file chips */}
          <div className="pointer-events-none absolute -left-2 top-10 hidden sm:block">
            <div className="w-12 h-14 rounded-lg bg-gradient-to-br from-rose-100 to-red-100 border border-rose-200 shadow-sm flex items-end justify-center pb-1 rotate-[-12deg]">
              <span className="text-[9px] font-extrabold text-rose-500">PDF</span>
            </div>
          </div>
          <div className="pointer-events-none absolute -right-2 top-6 hidden sm:block">
            <div className="w-11 h-12 rounded-lg bg-gradient-to-br from-emerald-100 to-teal-100 border border-emerald-200 shadow-sm flex items-end justify-center pb-1 rotate-[10deg]">
              <span className="text-[9px] font-extrabold text-emerald-600">JPG</span>
            </div>
          </div>
          <div className="pointer-events-none absolute -right-1 bottom-3 hidden sm:block">
            <div className="w-10 h-11 rounded-lg bg-gradient-to-br from-sky-100 to-blue-100 border border-sky-200 shadow-sm flex items-end justify-center pb-1 rotate-[6deg]">
              <span className="text-[9px] font-extrabold text-sky-600">PNG</span>
            </div>
          </div>

          <input
            ref={imgInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (e.target) e.target.value = '';
              if (f) handleImageExtract(f);
            }}
          />

          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 border border-violet-200 flex items-center justify-center shadow-sm"
          >
            {extracting ? (
              <Loader2 className="w-6 h-6 text-violet-600 animate-spin" />
            ) : (
              <UploadCloud className="w-6 h-6 text-violet-600" />
            )}
          </motion.div>
          <p className="mt-3 text-sm sm:text-base font-bold text-slate-800">
            Upload BL / Container Image <span className="text-slate-400 font-medium">(Optional)</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {extracting ? 'AI detecting BL & container…' : 'Drag & drop or click to browse · auto-detect & search'}
          </p>
          <p className="text-[11px] text-slate-400 mt-2">PDF, JPG, JPEG, PNG · Max 10 MB</p>
        </div>

        {/* Loading state */}
        <AnimatePresence mode="wait">
          {loading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-2xl border border-dashed border-violet-200 bg-white/70 p-6 text-center"
            >
              <Loader2 className="w-7 h-7 text-violet-600 animate-spin mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">Scanning your inbox…</p>
              <p className="text-xs text-slate-400 mt-1">Tap Cancel to stop</p>
            </motion.div>
          )}

          {!loading && sortedMatches.length > 0 && (
            <motion.div
              key="list"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-emerald-600 font-bold text-sm">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                  {sortedMatches.length} match{sortedMatches.length === 1 ? '' : 'es'} found
                  {matchedVia === 'container' && (
                    <span className="ml-1 text-[11px] font-semibold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">
                      via container
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-violet-100 text-xs font-semibold text-violet-700 shadow-sm"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Filters
                </button>
              </div>

              {sortedMatches.map((m) => (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-violet-100 bg-white/80 backdrop-blur-sm p-4 space-y-3 hover:border-violet-300 hover:shadow-md transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 space-y-2.5">
                      {/* Sender row */}
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Sender</p>
                          <p className="text-sm text-slate-800 font-medium truncate">{m.from || '—'}</p>
                        </div>
                      </div>
                      {/* Date row */}
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Date</p>
                          <p className="text-sm text-slate-800 font-medium truncate">{fmtDate(m.dateMs, m.date)}</p>
                        </div>
                      </div>
                      {/* Subject row */}
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                          <Mail className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Subject</p>
                          <p className="text-sm font-bold text-slate-900 truncate">
                            <Highlight text={m.subject || '—'} terms={searchedTerms} />
                          </p>
                          {m.snippet && (
                            <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                              <Highlight text={m.snippet} terms={searchedTerms} />
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-600 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      New
                    </span>
                  </div>

                  {/* Attachments (each with its own Add button) */}
                  <div className="space-y-2">
                    {(m.attachments && m.attachments.length > 0 ? m.attachments : [m.attachment]).map((att) => {
                      const key = `${m.id}::${att.attachmentId}`;
                      const isAdding = addingId === key;
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-3 rounded-xl border border-slate-100 bg-gradient-to-r from-slate-50/80 to-white p-3"
                        >
                          <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${extColor(att.mimeType)} text-white flex flex-col items-center justify-center shrink-0 shadow-md`}>
                            <FileText className="w-4 h-4" />
                            <span className="text-[8px] font-extrabold leading-none mt-0.5">
                              {extFromMime(att.mimeType)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">
                              <Highlight text={att.filename} terms={searchedTerms} />
                            </p>
                            <p className="text-xs text-slate-500">
                              {extFromMime(att.mimeType)} Document
                              {att.size ? ` · ${fmtSize(att.size)}` : ''}
                            </p>
                          </div>
                          <Button
                            onClick={() => handleAdd(m, att)}
                            disabled={addDisabled || isAdding}
                            size="sm"
                            className="h-10 px-4 rounded-xl gap-1.5 font-bold text-white bg-[linear-gradient(95deg,#7C3AED_0%,#C026D3_50%,#3B82F6_100%)] hover:opacity-95 shadow-md shadow-violet-500/30"
                          >
                            {isAdding ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Plus className="w-4 h-4" />
                            )}
                            {isAdding ? 'Adding…' : addButtonLabel}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {!loading && searched && sortedMatches.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-5 text-center"
            >
              <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-2">
                <ImageIcon className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-700">No matching emails found</p>
              <p className="text-xs text-slate-500 mt-1">Try a different BL or container number</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
