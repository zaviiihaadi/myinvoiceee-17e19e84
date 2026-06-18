// Gmail Search for BL Numbers via Connector Gateway
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY = 'https://connector-gateway.lovable.dev/google_mail/gmail/v1';

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(s);
}

async function gw(path: string, token: string, connKey: string): Promise<Response> {
  return fetch(`${GATEWAY}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'X-Connection-Api-Key': connKey },
  });
}

interface AttPart {
  filename: string;
  mimeType: string;
  body?: { attachmentId?: string; size?: number };
}
function collectAttachments(part: any, acc: AttPart[] = []): AttPart[] {
  if (!part) return acc;
  if (part.filename && part.body?.attachmentId) {
    acc.push({ filename: part.filename, mimeType: part.mimeType || 'application/octet-stream', body: part.body });
  }
  if (Array.isArray(part.parts)) for (const p of part.parts) collectAttachments(p, acc);
  return acc;
}
function headerVal(headers: any[], name: string): string {
  const h = headers?.find?.((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(
      authHeader.replace('Bearer ', ''),
    );
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_MAIL_API_KEY = Deno.env.get('GOOGLE_MAIL_API_KEY');
    if (!LOVABLE_API_KEY || !GOOGLE_MAIL_API_KEY) {
      return new Response(JSON.stringify({ error: 'Gmail connection not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const blNumber = String(body?.blNumber || '').trim();
    const messageId = body?.messageId ? String(body.messageId) : '';
    const attachmentId = body?.attachmentId ? String(body.attachmentId) : '';

    // ===== Mode 1: Download a specific attachment =====
    if (messageId && attachmentId) {
      const aRes = await gw(
        `/users/me/messages/${messageId}/attachments/${attachmentId}`,
        LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY,
      );
      if (!aRes.ok) {
        const t = await aRes.text();
        return new Response(JSON.stringify({ error: `Attachment fetch failed [${aRes.status}]`, detail: t }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const aJson = await aRes.json();
      const bytes = b64urlToBytes(aJson.data || '');
      const base64 = bytesToB64(bytes);
      return new Response(JSON.stringify({ base64 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== Mode 2: List matches =====
    if (!blNumber) {
      return new Response(JSON.stringify({ error: 'blNumber required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const q = encodeURIComponent(`("${blNumber}" OR filename:"${blNumber}") has:attachment`);
    const listRes = await gw(`/users/me/messages?maxResults=10&q=${q}`, LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY);
    if (!listRes.ok) {
      const t = await listRes.text();
      return new Response(JSON.stringify({ error: `Gmail search failed [${listRes.status}]`, detail: t }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const list = await listRes.json();
    const messages = list?.messages || [];
    if (messages.length === 0) {
      return new Response(JSON.stringify({ found: false, matches: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve every match in parallel — metadata + preferred attachment ref only (no bytes)
    const detailed = await Promise.all(messages.map(async (m: any) => {
      try {
        const mRes = await gw(`/users/me/messages/${m.id}?format=full`, LOVABLE_API_KEY, GOOGLE_MAIL_API_KEY);
        if (!mRes.ok) return null;
        const msg = await mRes.json();
        const atts = collectAttachments(msg.payload);
        if (atts.length === 0) return null;

        const preferred = atts.find((a) => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename))
          || atts.find((a) => /^image\//i.test(a.mimeType) || /\.(png|jpe?g)$/i.test(a.filename))
          || atts[0];

        const headers = msg.payload?.headers || [];
        const dateStr = headerVal(headers, 'Date');
        const internalMs = Number(msg.internalDate || 0);
        const parsedMs = dateStr ? Date.parse(dateStr) : NaN;
        const dateMs = isFinite(parsedMs) ? parsedMs : internalMs;

        return {
          id: msg.id,
          from: headerVal(headers, 'From'),
          subject: headerVal(headers, 'Subject'),
          date: dateStr,
          dateMs,
          snippet: msg.snippet || '',
          attachment: {
            filename: preferred.filename,
            mimeType: preferred.mimeType,
            size: preferred.body?.size || 0,
            attachmentId: preferred.body?.attachmentId || '',
          },
        };
      } catch {
        return null;
      }
    }));

    const matches = detailed.filter(Boolean).sort((a: any, b: any) => (b.dateMs || 0) - (a.dateMs || 0));

    return new Response(JSON.stringify({ found: matches.length > 0, matches }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('gmail-search-bl error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
