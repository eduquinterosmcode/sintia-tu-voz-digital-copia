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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAuth = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 30 bundle requests per minute per user
    const rl = checkRateLimit(user.id, "bundle", 30, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec, corsHeaders);

    const url = new URL(req.url);
    const meetingId = url.searchParams.get("meeting_id");
    const segmentPage = parseInt(url.searchParams.get("segment_page") || "0");
    const segmentLimit = Math.min(parseInt(url.searchParams.get("segment_limit") || "100"), 500);

    if (!meetingId) {
      return new Response(JSON.stringify({ error: "Falta meeting_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: meeting } = await supabase
      .from("meetings").select("*, sectors(key, name)").eq("id", meetingId).single();

    if (!meeting) {
      return new Response(JSON.stringify({ error: "Reunión no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: membership } = await supabase
      .from("org_members").select("id").eq("org_id", meeting.org_id).eq("user_id", user.id).single();

    if (!membership) {
      return new Response(JSON.stringify({ error: "Sin acceso" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [speakersRes, transcriptRes, segmentsRes, analysisRes, chatRes, audioRes] =
      await Promise.all([
        supabase.from("meeting_speakers").select("*").eq("meeting_id", meetingId),
        supabase.from("meeting_transcripts").select("*").eq("meeting_id", meetingId)
          .order("version", { ascending: false }).limit(1).single(),
        supabase.from("meeting_segments").select("*").eq("meeting_id", meetingId)
          .order("t_start_sec").range(segmentPage * segmentLimit, (segmentPage + 1) * segmentLimit - 1),
        supabase.from("meeting_analyses").select("*").eq("meeting_id", meetingId)
          .order("version", { ascending: false }).limit(1).single(),
        supabase.from("chat_messages").select("*").eq("meeting_id", meetingId)
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("meeting_audio").select("id, storage_path, mime_type, duration_sec, created_at")
          .eq("meeting_id", meetingId).order("created_at", { ascending: false }).limit(1).single(),
      ]);

    return new Response(
      JSON.stringify({
        meeting,
        speakers: speakersRes.data || [],
        transcript: transcriptRes.data || null,
        segments: segmentsRes.data || [],
        segment_page: segmentPage,
        analysis: analysisRes.data || null,
        chat_messages: (chatRes.data || []).reverse(),
        audio: audioRes.data || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Bundle error:", err);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
