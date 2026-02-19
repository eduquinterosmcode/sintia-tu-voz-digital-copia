import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const meetingId = url.searchParams.get("meeting_id");
    const segmentPage = parseInt(url.searchParams.get("segment_page") || "0");
    const segmentLimit = Math.min(parseInt(url.searchParams.get("segment_limit") || "100"), 500);

    if (!meetingId) {
      return new Response(JSON.stringify({ error: "Falta meeting_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Get meeting
    const { data: meeting } = await supabase
      .from("meetings")
      .select("*, sectors(key, name)")
      .eq("id", meetingId)
      .single();

    if (!meeting) {
      return new Response(JSON.stringify({ error: "Reunión no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify access
    const { data: membership } = await supabase
      .from("org_members")
      .select("id")
      .eq("org_id", meeting.org_id)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return new Response(JSON.stringify({ error: "Sin acceso" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parallel queries
    const [speakersRes, transcriptRes, segmentsRes, analysisRes, chatRes, audioRes] =
      await Promise.all([
        supabase
          .from("meeting_speakers")
          .select("*")
          .eq("meeting_id", meetingId),
        supabase
          .from("meeting_transcripts")
          .select("*")
          .eq("meeting_id", meetingId)
          .order("version", { ascending: false })
          .limit(1)
          .single(),
        supabase
          .from("meeting_segments")
          .select("*")
          .eq("meeting_id", meetingId)
          .order("t_start_sec")
          .range(segmentPage * segmentLimit, (segmentPage + 1) * segmentLimit - 1),
        supabase
          .from("meeting_analyses")
          .select("*")
          .eq("meeting_id", meetingId)
          .order("version", { ascending: false })
          .limit(1)
          .single(),
        supabase
          .from("chat_messages")
          .select("*")
          .eq("meeting_id", meetingId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("meeting_audio")
          .select("id, mime_type, duration_sec, created_at")
          .eq("meeting_id", meetingId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single(),
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
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
