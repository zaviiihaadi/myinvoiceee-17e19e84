const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Shipping line configurations
const shippingLines = [
  { prefix: 'MSCU', name: 'MSC', fullName: 'Mediterranean Shipping Company' },
  { prefix: 'MAEU', name: 'Maersk', fullName: 'Maersk Line' },
  { prefix: 'CMAU', name: 'CMA CGM', fullName: 'CMA CGM' },
  { prefix: 'HLCU', name: 'Hapag-Lloyd', fullName: 'Hapag-Lloyd' },
  { prefix: 'COSU', name: 'COSCO', fullName: 'COSCO Shipping' },
  { prefix: 'EGLV', name: 'Evergreen', fullName: 'Evergreen Line' },
  { prefix: 'OOLU', name: 'OOCL', fullName: 'Orient Overseas Container Line' },
  { prefix: 'YMLU', name: 'Yang Ming', fullName: 'Yang Ming Marine' },
  { prefix: 'ONEY', name: 'ONE', fullName: 'Ocean Network Express' },
  { prefix: 'HDMU', name: 'Hyundai', fullName: 'Hyundai Merchant Marine' },
];

const locations = ['Singapore Port', 'Rotterdam, Netherlands', 'Shanghai, China', 'Los Angeles, USA', 'Hamburg, Germany', 'Busan, South Korea', 'Hong Kong, China', 'Antwerp, Belgium', 'Dubai, UAE'];
const vessels = ['MSC OSCAR', 'MAERSK ELBA', 'CMA CGM MARCO POLO', 'EVER GIVEN', 'COSCO UNIVERSE', 'OOCL HONG KONG', 'HMM ALGECIRAS'];
const statuses = ['In Transit', 'Arrived', 'Discharged', 'Loading', 'Pending'];

function generateMockTrackingData(containerNumber: string) {
  const prefix = containerNumber.substring(0, 4).toUpperCase();
  const shippingLine = shippingLines.find(sl => sl.prefix === prefix) || shippingLines[Math.floor(Math.random() * shippingLines.length)];
  const now = new Date();
  const eta = new Date(now.getTime() + (Math.floor(Math.random() * 14) + 1) * 24 * 60 * 60 * 1000);
  const lastUpdate = new Date(now.getTime() - Math.floor(Math.random() * 24) * 60 * 60 * 1000);

  return {
    containerNumber,
    shippingLine: shippingLine.fullName,
    currentLocation: locations[Math.floor(Math.random() * locations.length)],
    vesselName: vessels[Math.floor(Math.random() * vessels.length)],
    voyageNumber: `${shippingLine.prefix.substring(0, 2)}${Math.floor(Math.random() * 9000) + 1000}E`,
    eta: eta.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    lastUpdate: lastUpdate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    status: statuses[Math.floor(Math.random() * statuses.length)],
    error: null
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { containerNumber } = await req.json();
    if (!containerNumber) {
      return new Response(JSON.stringify({ success: false, error: 'Container number required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const containerPattern = /^[A-Z]{3,4}\d{6,7}$/;
    if (!containerPattern.test(containerNumber.toUpperCase())) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid format', data: { containerNumber, shippingLine: '', currentLocation: '', vesselName: '', voyageNumber: '', eta: '', lastUpdate: '', status: 'Not Available', error: 'Invalid format' } }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
    const trackingData = generateMockTrackingData(containerNumber.toUpperCase());
    console.log(`Tracked container: ${containerNumber}`);

    return new Response(JSON.stringify({ success: true, data: trackingData }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Tracking error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
