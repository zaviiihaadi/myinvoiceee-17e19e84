import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const messages: any[] = [
      {
        role: 'system',
        content: `You are a document layout analyzer. Analyze this invoice/packing template and extract its exact structure.

Return ONLY a JSON object describing the layout:
{
  "title": "<main title text e.g. INVOICE/PACKING>",
  "has_shipper_section": true/false,
  "has_consignee_section": true/false,
  "has_notify_party": true/false,
  "has_container_info": true/false,
  "has_vessel_section": true/false,
  "has_port_section": true/false,
  "has_hs_code": true/false,
  "has_goods_description": true/false,
  "has_shipping_marks": true/false,
  "has_weight_pricing": true/false,
  "has_bales_packages": true/false,
  "has_stamp_area": true/false,
  "company_name_position": "bottom" or "top",
  "layout_style": "two-column" or "single-column",
  "sections_order": ["shipper", "notify_party", "consignee", "container", "vessel", "ports", "goods", "weight", "company"]
}

Analyze the visual layout carefully.`
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${fileBase64}`
            }
          },
          {
            type: 'text',
            text: 'Analyze this invoice template layout and return the structure as JSON.'
          }
        ]
      }
    ];

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', errorText);
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
    } catch {
      console.error('Failed to parse AI response:', content);
      parsed = null;
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in extract-template-layout:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
