import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are an EXPERT Bill of Lading (BL) and shipping-invoice document understanding engine.

Your job is NOT to look for fixed labels. Instead, understand the ENTIRE document like a human shipping clerk would:
- Read every text block (headers, tables, footers, stamps, handwritten notes).
- Infer the MEANING of each block from context, position, neighboring text, formatting, and shipping-industry conventions — not from a fixed keyword list.
- Work across ANY carrier layout (Maersk, MSC, ONE, Hapag, COSCO, OOCL, Evergreen, ZIM, CMA CGM, small freight forwarders, house BLs, sea waybills, telex releases, scanned/rotated/low-quality copies, multi-page docs, screenshots of Excel).
- If a label is missing, infer the field from context. Example: a block containing "USED CLOTHING, SHOES & OTHER WORN ARTICLES" is the Goods Description even if no "Description of Goods" label exists nearby.
- Rotate/deskew mentally if the document is rotated. Handle poor OCR by using domain knowledge (e.g. ISO 6346 container format = 4 letters + 6-7 digits; weights end in KGS/KG/MT/LBS; BL numbers are uppercase alphanumeric 6-24 chars often with hyphens/slashes).
- Never guess. If unsure, lower the confidence score.

For EVERY field, return both the value and a confidence score from 0.0 to 1.0 based on:
- Clarity of the source text
- Strength of contextual evidence
- Agreement across multiple mentions in the document

Return ONLY a JSON object (no markdown, no code fences) with this exact structure:
{
  "bl_number": "<string or null>",
  "bl_number_confidence": <0.0-1.0>,
  "container_numbers": ["<string>"],
  "container_numbers_confidence": <0.0-1.0>,
  "container_size": "<string or null>",
  "kgs": <number or null>,
  "kgs_confidence": <0.0-1.0>,
  "raw_weight_text": "<exact text where weight was found>",
  "net_weight": <number or null>,
  "net_weight_confidence": <0.0-1.0>,
  "description": "<goods description string or null>",
  "description_confidence": <0.0-1.0>,
  "consignee": "<string or null>",
  "consignee_address": "<string or null>",
  "consignee_confidence": <0.0-1.0>,
  "shipper": "<string or null>",
  "shipper_address": "<string or null>",
  "shipper_confidence": <0.0-1.0>,
  "notify_party": "<string or null>",
  "notify_party_address": "<string or null>",
  "notify_party_confidence": <0.0-1.0>,
  "vessel_name": "<string or null>",
  "voyage": "<string or null>",
  "vessel_confidence": <0.0-1.0>,
  "port_of_loading": "<string or null>",
  "port_of_discharge": "<string or null>",
  "port_confidence": <0.0-1.0>,
  "seal_numbers": ["<string>"],
  "seal_confidence": <0.0-1.0>,
  "packages": "<string or null>",
  "bales": <number or null>,
  "package_type": "<string e.g. BALES/PKGS/CTNS/PLTS or null>",
  "packages_confidence": <0.0-1.0>,
  "marks_and_numbers": "<string or null>",
  "shipping_marks": "<string or null>",
  "marks_confidence": <0.0-1.0>,
  "hs_code": "<string or null>",
  "hs_code_confidence": <0.0-1.0>,
  "bl_date": "<date string as found or null>",
  "all_bl_numbers": ["<every distinct BL/Invoice number visible anywhere>"],
  "all_container_numbers": ["<every distinct ISO 6346 container number visible anywhere>"],
  "raw_text": "<compact dump of all uppercase alphanumeric tokens/codes for downstream regex fallback>",
  "overall_confidence": <0.0-1.0>,
  "low_confidence_fields": ["<field names where confidence < 0.7>"]
}

Rules:
- container_numbers must match ISO 6346 (4 uppercase letters + 6-7 digits). Deduplicate.
- If a field cannot be found even by inference, set value to null and confidence to 0.
- If multiple candidates exist, pick the one with the highest contextual confidence.
- description should be the CARGO description (what is being shipped), not vessel or route descriptions.`;

async function callAI(apiKey: string, messages: any[], model = 'google/gemini-2.5-flash') {
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature: 0.1 }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error('AI Gateway error:', response.status, errorText);
    throw new Error(`AI Gateway error: ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

function parseJson(content: string): any {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
  } catch {
    console.error('Failed to parse AI response:', content?.slice(0, 500));
    return null;
  }
}

function computeLowConfidenceFields(parsed: any): string[] {
  const map: Record<string, string> = {
    bl_number: 'bl_number_confidence',
    container_numbers: 'container_numbers_confidence',
    kgs: 'kgs_confidence',
    description: 'description_confidence',
    consignee: 'consignee_confidence',
    shipper: 'shipper_confidence',
    notify_party: 'notify_party_confidence',
    vessel_name: 'vessel_confidence',
    port_of_loading: 'port_confidence',
    packages: 'packages_confidence',
  };
  const low: string[] = [];
  for (const [field, conf] of Object.entries(map)) {
    const val = parsed?.[field];
    const c = typeof parsed?.[conf] === 'number' ? parsed[conf] : 0;
    const hasVal = Array.isArray(val) ? val.length > 0 : val !== null && val !== undefined && val !== '';
    if (!hasVal || c < 0.7) low.push(field);
  }
  return low;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileBase64, mimeType } = await req.json();
    if (!fileBase64) {
      return new Response(JSON.stringify({ error: 'No file data provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const userContent = [
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
      {
        type: 'text',
        text: 'Perform intelligent document understanding on this Bill of Lading / shipping document. Read the ENTIRE document, infer field meanings from context (not fixed labels), handle any layout, rotation, or scan quality, and return the full JSON with per-field confidence scores.',
      },
    ];

    // Pass 1: primary extraction
    const firstRaw = await callAI(LOVABLE_API_KEY, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ]);
    let parsed = parseJson(firstRaw) || { kgs: null, raw_weight_text: firstRaw };

    // Pass 2: validation pass if any critical field is low-confidence
    const lowFields = computeLowConfidenceFields(parsed);
    if (lowFields.length > 0) {
      console.log('Running validation pass for low-confidence fields:', lowFields);
      try {
        const validationPrompt = `A first extraction pass returned low confidence for these fields: ${lowFields.join(', ')}.
Re-analyze the document with FULL attention to those fields. Use semantic understanding, not label matching. Verify or correct every value. Then return the COMPLETE JSON in the same schema (all fields, not just the low-confidence ones), with updated confidence scores.

Previous extraction (for reference, may be wrong):
${JSON.stringify(parsed).slice(0, 4000)}`;

        const secondRaw = await callAI(LOVABLE_API_KEY, [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              ...userContent,
              { type: 'text', text: validationPrompt },
            ],
          },
        ], 'google/gemini-2.5-pro');

        const secondParsed = parseJson(secondRaw);
        if (secondParsed) {
          // Merge: prefer higher-confidence value per field
          const merged: any = { ...parsed };
          for (const field of Object.keys(secondParsed)) {
            if (field.endsWith('_confidence')) continue;
            const confKey = `${field}_confidence`;
            const oldConf = typeof parsed[confKey] === 'number' ? parsed[confKey] : 0;
            const newConf = typeof secondParsed[confKey] === 'number' ? secondParsed[confKey] : 0;
            if (newConf >= oldConf) {
              merged[field] = secondParsed[field];
              if (confKey in secondParsed) merged[confKey] = newConf;
            }
          }
          parsed = merged;
        }
      } catch (e) {
        console.error('Validation pass failed, keeping first pass result:', e);
      }
    }

    parsed.low_confidence_fields = computeLowConfidenceFields(parsed);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in extract-bl-data:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
