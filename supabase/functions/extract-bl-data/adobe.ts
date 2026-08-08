// Adobe PDF Services — Extract API based BL/Invoice content extraction (no AI).
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';

const ADOBE_HOST = 'https://pdf-services-ue1.adobe.io';
const ADOBE_TOKEN_URL = 'https://pdf-services-ue1.adobe.io/token';

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const r = await fetch(ADOBE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }),
  });
  if (!r.ok) throw new Error(`Adobe token failed [${r.status}]: ${await r.text()}`);
  return (await r.json()).access_token as string;
}

function adobeHeaders(token: string, clientId: string, orgId?: string) {
  const h: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'X-API-Key': clientId,
  };
  if (orgId) h['x-gw-ims-org-id'] = orgId;
  return h;
}

async function uploadAsset(token: string, clientId: string, orgId: string | undefined, bytes: Uint8Array, mediaType: string) {
  const pre = await fetch(`${ADOBE_HOST}/assets`, {
    method: 'POST',
    headers: { ...adobeHeaders(token, clientId, orgId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaType }),
  });
  if (!pre.ok) throw new Error(`Adobe presign failed [${pre.status}]: ${await pre.text()}`);
  const { uploadUri, assetID } = await pre.json();
  const up = await fetch(uploadUri, { method: 'PUT', headers: { 'Content-Type': mediaType }, body: bytes });
  if (!up.ok) throw new Error(`Adobe upload failed [${up.status}]`);
  return assetID as string;
}

async function pollJob(token: string, clientId: string, orgId: string | undefined, location: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await fetch(location, { headers: adobeHeaders(token, clientId, orgId) });
    if (!r.ok) throw new Error(`Adobe poll failed [${r.status}]: ${await r.text()}`);
    const j = await r.json();
    if (j.status === 'done') return j;
    if (j.status === 'failed') throw new Error(`Adobe extract job failed: ${JSON.stringify(j)}`);
  }
  throw new Error('Adobe extract job timed out');
}

/** Runs Adobe Extract on a PDF and returns the plain text lines in reading order. */
export async function adobeExtractLines(
  pdfBytes: Uint8Array,
  clientId: string,
  clientSecret: string,
  orgId?: string,
): Promise<string[]> {
  const token = await getToken(clientId, clientSecret);
  const assetID = await uploadAsset(token, clientId, orgId, pdfBytes, 'application/pdf');

  const job = await fetch(`${ADOBE_HOST}/operation/extractpdf`, {
    method: 'POST',
    headers: { ...adobeHeaders(token, clientId, orgId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetID, elementsToExtract: ['text'], getCharBounds: false, includeStyling: false }),
  });
  if (job.status !== 201) throw new Error(`Adobe extract create failed [${job.status}]: ${await job.text()}`);
  const location = job.headers.get('location');
  if (!location) throw new Error('Adobe extract: no location header');

  const result = await pollJob(token, clientId, orgId, location) as {
    asset?: { downloadUri?: string };
    resource?: { downloadUri?: string };
  };
  const downloadUri = result?.resource?.downloadUri ?? result?.asset?.downloadUri;
  if (!downloadUri) throw new Error('Adobe extract: no downloadUri');

  const res = await fetch(downloadUri);
  if (!res.ok) throw new Error(`Adobe extract download failed [${res.status}]`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  // Response is a ZIP containing structuredData.json (sometimes raw JSON).
  let jsonText: string | null = null;
  try {
    const files = unzipSync(bytes);
    const key = Object.keys(files).find((k) => k.endsWith('structuredData.json')) ?? Object.keys(files)[0];
    jsonText = strFromU8(files[key]);
  } catch {
    jsonText = new TextDecoder().decode(bytes);
  }

  const parsed = JSON.parse(jsonText!);
  const elements: any[] = parsed?.elements ?? [];
  const lines: string[] = [];
  for (const el of elements) {
    const t = typeof el?.Text === 'string' ? el.Text.replace(/\s+/g, ' ').trim() : '';
    if (t) lines.push(t);
  }
  return lines;
}

// ---------------- Deterministic BL/Invoice parser (no AI) ----------------

const CONTAINER_RE = /\b([A-Z]{4}\s?\d{6,7})\b/g;
const BL_RE = /\b([A-Z]{2,6}[A-Z0-9]*[-/]?[A-Z0-9]{2,}[-/]?[A-Z0-9]*)\b/g;

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function findAfterLabel(lines: string[], labels: string[], maxLines = 4): string | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toUpperCase();
    for (const label of labels) {
      const idx = l.indexOf(label);
      if (idx === -1) continue;
      // Same-line value after the label / colon
      const after = lines[i].slice(idx + label.length).replace(/^[\s:.\-]+/, '').trim();
      if (after.length > 1) return after;
      // Otherwise take following lines until the next label-ish line
      const collected: string[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 1 + maxLines); j++) {
        const nxt = lines[j].trim();
        if (!nxt) continue;
        if (/^(SHIPPER|CONSIGNEE|NOTIFY|PORT OF|PLACE OF|VESSEL|BOOKING|B\/L|BILL OF LADING|CONTAINER|DESCRIPTION|MARKS|GROSS|NET|HS CODE)\b/i.test(nxt)) break;
        collected.push(nxt);
      }
      if (collected.length) return collected.join('\n');
    }
  }
  return null;
}

function splitNameAddress(block: string | null): { name: string | null; address: string | null } {
  if (!block) return { name: null, address: null };
  const parts = block.split('\n').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { name: null, address: null };
  return { name: parts[0], address: parts.slice(1).join('\n') || null };
}

/** Parses a weight token that may use either , or . as decimal/thousand separators. */
function parseWeightToken(tok: string): number | null {
  let s = tok.trim().replace(/\s/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // The later separator is the decimal one
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "12,345" -> thousands ; "12,5" -> decimal
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : null;
}

/** Finds the gross weight in KGS. Tries labelled matches first, then any KGS token. */
export function extractWeightKgs(text: string): { kgs: number | null; rawWeightText: string | null } {
  const candidates: { value: number; raw: string; score: number }[] = [];
  const push = (value: number | null, raw: string, score: number) => {
    if (value && value >= 50 && value <= 100000) candidates.push({ value, raw, score });
  };

  const NUM = String.raw`\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?`;

  // 1. Labelled: "GROSS WEIGHT : 12,345.00 KGS"
  const labelled = new RegExp(
    String.raw`(?:GROSS\s*(?:WEIGHT|WT\.?)|G\.?\s*W(?:EIGHT|T)?\.?|TOTAL\s*(?:GROSS\s*)?WEIGHT|WEIGHT)\s*(?:\(?\s*KGS?\s*\)?)?\s*[:.\-=]?\s*(${NUM})\s*(?:KGS?|KILOS?|KILOGRAMS?)?`,
    'gi',
  );
  for (const m of text.matchAll(labelled)) push(parseWeightToken(m[1]), m[0].trim(), 3);

  // 2. Number immediately followed by KGS
  const withUnit = new RegExp(String.raw`(${NUM})\s*(?:KGS?|KILOS?|KILOGRAMS?)\b`, 'gi');
  for (const m of text.matchAll(withUnit)) push(parseWeightToken(m[1]), m[0].trim(), 2);

  // 3. "KGS 12345" (unit before value)
  const unitFirst = new RegExp(String.raw`\bKGS?\b\s*[:.\-]?\s*(${NUM})`, 'gi');
  for (const m of text.matchAll(unitFirst)) push(parseWeightToken(m[1]), m[0].trim(), 1);

  if (!candidates.length) return { kgs: null, rawWeightText: null };
  candidates.sort((a, b) => (b.score - a.score) || (b.value - a.value));
  return { kgs: candidates[0].value, rawWeightText: candidates[0].raw };
}

export function parseBlText(lines: string[]) {
  const text = lines.join('\n');
  const upper = text.toUpperCase();

  // Weight (KGS)
  const { kgs, rawWeightText } = extractWeightKgs(text);


  // Bales / packages
  let bales: number | null = null;
  const balesMatch = text.match(/(\d{1,5})\s*(?:BALES?|PKGS?|PACKAGES?|CTNS?)/i);
  if (balesMatch) bales = parseInt(balesMatch[1], 10);
  const packages = balesMatch ? balesMatch[0].trim() : null;

  // Containers
  const containers = uniq((upper.match(CONTAINER_RE) || []).map((c) => c.replace(/\s/g, '')));

  // Container size
  const sizeMatch = text.match(/\b(\d\s*X\s*\d{2}\s*'?\s*(?:HC|GP|HQ|DV|RF|OT)?)/i) || text.match(/\b(20|40|45)\s*'?\s*(HC|GP|HQ|DV|RF|OT)\b/i);
  const containerSize = sizeMatch ? sizeMatch[0].replace(/\s+/g, ' ').trim() : null;

  // BL / Invoice number
  const blNumber =
    (text.match(/(?:B\/?L\s*(?:NO|NUMBER|#)|BILL\s+OF\s+LADING\s*(?:NO|NUMBER)|DOCUMENT\s*NO|INVOICE\s*(?:NO|NUMBER|#))\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,23})/i)?.[1] ?? null);

  // Every uppercase code that looks like a BL/invoice number
  const allBl = uniq(
    (upper.match(BL_RE) || []).filter(
      (t) => /\d/.test(t) && t.length >= 6 && t.length <= 24 && !/^[A-Z]{4}\d{6,7}$/.test(t),
    ),
  ).slice(0, 40);

  const shipperBlock = findAfterLabel(lines, ['SHIPPER/EXPORTER', 'SHIPPER'], 5);
  const consigneeBlock = findAfterLabel(lines, ['CONSIGNEE'], 5);
  const notifyBlock = findAfterLabel(lines, ['NOTIFY PARTY', 'NOTIFY'], 5);

  const shipper = splitNameAddress(shipperBlock);
  const consignee = splitNameAddress(consigneeBlock);
  const notify = splitNameAddress(notifyBlock);

  const portOfLoading = findAfterLabel(lines, ['PORT OF LOADING', 'PLACE OF RECEIPT', 'LOADING PORT'], 2);
  const portOfDischarge = findAfterLabel(lines, ['PORT OF DISCHARGE', 'PLACE OF DELIVERY', 'DISCHARGE PORT', 'DESTINATION'], 2);
  const vessel = findAfterLabel(lines, ['VESSEL AND VOYAGE', 'VESSEL/VOYAGE', 'OCEAN VESSEL', 'VESSEL', 'FLIGHT'], 2);
  const hsCode = text.match(/H\.?S\.?\s*CODE\s*[:.\-]?\s*([\d.]{4,12})/i)?.[1] ?? null;
  const shippingMarks = findAfterLabel(lines, ['SHIPPING MARKS', 'MARKS AND NUMBERS', 'MARKS & NOS'], 4);

  // Goods description
  let description: string | null = findAfterLabel(lines, ['DESCRIPTION OF GOODS', 'DESCRIPTION OF PACKAGES AND GOODS', 'DESCRIPTION'], 6);
  if (!description) {
    const m = text.match(/(MIX(?:ED)?\s+USED\s+CLOTHING|USED\s+CLOTHING)[\s\S]{0,160}/i);
    if (m) description = m[0].replace(/\s+/g, ' ').trim();
  }

  // Date
  const blDate =
    text.match(/(?:SHIPPED\s+ON\s+BOARD(?:\s+DATE)?|B\/?L\s*DATE|ISSUE\s*DATE|DATE\s*OF\s*ISSUE|DATE)\s*[:.\-]?\s*(\d{1,2}[-/.\s][A-Z0-9]{2,9}[-/.\s]\d{2,4})/i)?.[1] ??
    text.match(/\b(\d{1,2}[-/.][A-Z0-9]{2,9}[-/.]\d{2,4})\b/i)?.[1] ??
    null;

  return {
    kgs,
    shipper: shipper.name,
    shipper_address: shipper.address,
    consignee: consignee.name,
    consignee_address: consignee.address,
    notify_party: notify.name,
    notify_party_address: notify.address,
    port_of_loading: portOfLoading,
    port_of_discharge: portOfDischarge,
    description,
    packages,
    bales,
    container_numbers: containers,
    container_size: containerSize,
    bl_number: blNumber ?? allBl[0] ?? null,
    vessel_name: vessel,
    hs_code: hsCode,
    shipping_marks: shippingMarks,
    bl_date: blDate,
    raw_weight_text: rawWeightText,
    all_bl_numbers: blNumber ? uniq([blNumber, ...allBl]) : allBl,
    all_container_numbers: containers,
    raw_text: text,
    source: 'adobe' as const,
  };
}
