import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendCodeRequest {
  email: string;
  userId: string;
}

interface VerifyCodeRequest {
  email: string;
  userId: string;
  code: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'send';

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (action === 'send') {
      const { email, userId }: SendCodeRequest = await req.json();

      if (!email || !userId) {
        return new Response(
          JSON.stringify({ error: "Email and userId are required" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      console.log(`Generating verification code for ${email}: ${code}`);

      // Delete any existing codes for this user
      await supabase
        .from('verification_codes')
        .delete()
        .eq('user_id', userId)
        .eq('email', email);

      // Insert new code
      const { error: insertError } = await supabase
        .from('verification_codes')
        .insert({
          user_id: userId,
          email,
          code,
          expires_at: expiresAt.toISOString(),
          verified: false,
        });

      if (insertError) {
        console.error("Error inserting verification code:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to create verification code" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Send email via Resend
      if (resendApiKey) {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: "CargoTrack Pro <onboarding@resend.dev>",
            to: [email],
            subject: "Verify your email - CargoTrack Pro",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #0f766e; text-align: center;">CargoTrack Pro</h1>
                <h2 style="text-align: center;">Verify Your Email</h2>
                <p style="text-align: center; color: #666;">Enter this code to verify your email address:</p>
                <div style="background: #f3f4f6; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
                  <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #0f766e;">${code}</span>
                </div>
                <p style="text-align: center; color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
                <p style="text-align: center; color: #999; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
              </div>
            `,
          }),
        });

        if (!emailResponse.ok) {
          const errorData = await emailResponse.text();
          console.error("Resend error:", errorData);
          // Still return success - code is created, email just failed
          return new Response(
            JSON.stringify({ success: true, message: "Code created but email may not have been sent" }),
            { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

        console.log("Verification email sent successfully");
      } else {
        console.log("RESEND_API_KEY not configured, code created but email not sent");
      }

      return new Response(
        JSON.stringify({ success: true, message: "Verification code sent" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );

    } else if (action === 'verify') {
      const { email, userId, code }: VerifyCodeRequest = await req.json();

      if (!email || !userId || !code) {
        return new Response(
          JSON.stringify({ error: "Email, userId, and code are required" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      console.log(`Verifying code for ${email}: ${code}`);

      // Find the verification code
      const { data: codeData, error: codeError } = await supabase
        .from('verification_codes')
        .select('*')
        .eq('user_id', userId)
        .eq('email', email)
        .eq('code', code)
        .eq('verified', false)
        .gte('expires_at', new Date().toISOString())
        .maybeSingle();

      if (codeError || !codeData) {
        console.log("Invalid or expired code");
        return new Response(
          JSON.stringify({ error: "Invalid or expired verification code" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Mark code as verified
      await supabase
        .from('verification_codes')
        .update({ verified: true })
        .eq('id', codeData.id);

      // Update profile to mark email as verified
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ email_verified: true })
        .eq('user_id', userId);

      if (profileError) {
        console.error("Error updating profile:", profileError);
      }

      console.log("Email verified successfully");

      return new Response(
        JSON.stringify({ success: true, message: "Email verified successfully" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );

    } else {
      return new Response(
        JSON.stringify({ error: "Invalid action" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  } catch (error: any) {
    console.error("Error in verify-email function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
