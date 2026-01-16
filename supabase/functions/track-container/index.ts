import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const API_BASE = 'https://tracking.timetocargo.com/v1';

interface TimeToCargoEvent {
  date?: string;
  location?: string;
  description?: string;
  vessel?: string;
  voyage?: string;
}

interface TimeToCargoLocation {
  id?: number;
  name?: string;
  country?: string;
}

interface TimeToCargoResponse {
  success?: boolean;
  data?: {
    summary?: {
      company?: {
        full_name?: string;
      };
      pod?: {
        location?: number;
        date?: string;
      };
      pol?: {
        location?: number;
        date?: string;
      };
    };
    locations?: TimeToCargoLocation[];
    container?: {
      number?: string;
      events?: TimeToCargoEvent[];
    };
  };
  error?: string;
  message?: string;
}

function parseTrackingData(containerNumber: string, apiResponse: TimeToCargoResponse) {
  const data = apiResponse.data;
  
  if (!data) {
    return {
      containerNumber,
      shippingLine: '',
      currentLocation: '',
      vesselName: '',
      voyageNumber: '',
      eta: '',
      lastUpdate: '',
      status: 'Not Available' as const,
      destinationPort: '',
      error: apiResponse.message || apiResponse.error || 'No data available'
    };
  }

  const events = data.container?.events || [];
  const latestEvent = events[0];
  const summary = data.summary;
  const locations = data.locations || [];
  
  // Get ETA from summary.pod.date
  const eta = summary?.pod?.date || '';
  
  // Get destination port name from locations array using pod.location index
  const podLocationIndex = summary?.pod?.location;
  const destinationPort = podLocationIndex !== undefined && locations[podLocationIndex] 
    ? locations[podLocationIndex].name || ''
    : '';
  
  // Determine status from latest event description
  let status = 'In Transit';
  if (latestEvent?.description) {
    const desc = latestEvent.description.toLowerCase();
    if (desc.includes('discharged') || desc.includes('unloaded')) {
      status = 'Discharged';
    } else if (desc.includes('arrived') || desc.includes('arrival')) {
      status = 'Arrived';
    } else if (desc.includes('loaded') || desc.includes('loading')) {
      status = 'Loading';
    } else if (desc.includes('gate out') || desc.includes('delivered')) {
      status = 'Delivered';
    } else if (desc.includes('pending') || desc.includes('booked')) {
      status = 'Pending';
    }
  }

  console.log(`Parsed ETA for ${containerNumber}: ${eta}`);

  return {
    containerNumber: data.container?.number || containerNumber,
    shippingLine: summary?.company?.full_name || '',
    currentLocation: latestEvent?.location || '',
    vesselName: latestEvent?.vessel || '',
    voyageNumber: latestEvent?.voyage || '',
    eta,
    lastUpdate: latestEvent?.date || '',
    status,
    destinationPort,
    error: null
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      console.error('Auth error:', claimsError);
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claimsData.claims.sub;
    console.log(`Authenticated user: ${userId}`);

    const { containerNumber } = await req.json();
    
    if (!containerNumber) {
      return new Response(
        JSON.stringify({ success: false, error: 'Container number required' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const containerPattern = /^[A-Z]{3,4}\d{6,7}$/;
    if (!containerPattern.test(containerNumber.toUpperCase())) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid format', 
          data: { 
            containerNumber, 
            shippingLine: '', 
            currentLocation: '', 
            vesselName: '', 
            voyageNumber: '', 
            eta: '', 
            lastUpdate: '', 
            status: 'Not Available', 
            destinationPort: '',
            error: 'Invalid container number format' 
          } 
        }), 
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('TIMETOCARGO_API_KEY');
    
    if (!apiKey) {
      console.error('TIMETOCARGO_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'API key not configured' }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = `${API_BASE}/container?api_key=${encodeURIComponent(apiKey)}&company=AUTO&container_number=${encodeURIComponent(containerNumber.toUpperCase())}`;
    
    console.log(`Tracking container: ${containerNumber}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`TimeToCargo API error: ${response.status} - ${errorText}`);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Rate limit exceeded. Please try again later.',
            data: {
              containerNumber,
              shippingLine: '',
              currentLocation: '',
              vesselName: '',
              voyageNumber: '',
              eta: '',
              lastUpdate: '',
              status: 'Not Available',
              destinationPort: '',
              error: 'Rate limit exceeded'
            }
          }), 
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `API error: ${response.status}`,
          data: {
            containerNumber,
            shippingLine: '',
            currentLocation: '',
            vesselName: '',
            voyageNumber: '',
            eta: '',
            lastUpdate: '',
            status: 'Not Available',
            destinationPort: '',
            error: `API error: ${response.status}`
          }
        }), 
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiData: TimeToCargoResponse = await response.json();
    console.log(`TimeToCargo response for ${containerNumber}:`, JSON.stringify(apiData).substring(0, 500));
    
    const trackingData = parseTrackingData(containerNumber.toUpperCase(), apiData);
    
    return new Response(
      JSON.stringify({ success: true, data: trackingData }), 
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    // Sanitize error to avoid exposing sensitive data like API keys
    const sanitizedError = error instanceof Error 
      ? { message: error.message, name: error.name } 
      : 'Unknown error';
    console.error('Tracking error:', sanitizedError);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
