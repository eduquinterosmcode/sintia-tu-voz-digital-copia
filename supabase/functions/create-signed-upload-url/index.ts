import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, handleCorsPreflightOrForbidden } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

Deno.serve(async (req) => {
  const corsCheck = handleCorsPreflightOrForbidden(req);
  if (corsCheck) return corsCheck;
  const corsHeaders = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 10 upload URL requests per minute per user
    const rl = checkRateLimit(user.id, "upload-url", 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec, corsHeaders);

    const { meeting_id, filename, mime_type } = await req.json();
    if (!meeting_id || !filename || !mime_type) {
      return new Response(
        JSON.stringify({ error: "Faltan parámetros: meeting_id, filename, mime_type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: meeting, error: meetingError } = await supabase
      .from("meetings").select("id, org_id").eq("id", meeting_id).single();

    if (meetingError || !meeting) {
      return new Response(JSON.stringify({ error: "Reunión no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: membership } = await supabase
      .from("org_members").select("id").eq("org_id", meeting.org_id).eq("user_id", user.id).single();

    if (!membership) {
      return new Response(JSON.stringify({ error: "Sin acceso a esta organización" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sanitize filename: Supabase Storage keys only allow alphanumeric, hyphens, underscores, and dots.
    // Spaces, brackets, and other special chars cause an "InvalidKey" 400 error.
    const safeFilename = filename
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .replace(/[^a-zA-Z0-9._-]/g, "_")                // replace invalid chars with _
      .replace(/_+/g, "_")                              // collapse consecutive underscores
      .slice(0, 100);                                   // cap length
    const storagePath = `${meeting.org_id}/${meeting_id}/${crypto.randomUUID()}-${safeFilename}`;

    const { data: signedData, error: signedError } = await supabase.storage
      .from("meeting-audio").createSignedUploadUrl(storagePath);

    if (signedError) {
      console.error("Signed URL error:", signedError);
      return new Response(
        JSON.stringify({ error: "Error al crear URL de subida" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ signed_url: signedData.signedUrl, storage_path: storagePath, token: signedData.token }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    const corsHeaders = getCorsHeaders(req);
    return new Response(JSON.stringify({ error: "Error interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
