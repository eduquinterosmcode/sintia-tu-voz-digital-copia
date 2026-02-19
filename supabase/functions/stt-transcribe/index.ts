import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, handleCorsPreflightOrForbidden } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

interface DiarizedSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

async function verifyUserAndMeeting(
  supabaseUrl: string,
  serviceKey: string,
  authHeader: string,
  meetingId: string
) {
  const supabaseAuth = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await supabaseAuth.auth.getUser();
  if (userError || !user) throw new Error("No autorizado");

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, org_id, sector_id, language")
    .eq("id", meetingId)
    .single();
  if (!meeting) throw new Error("Reunión no encontrada");

  const { data: membership } = await supabase
    .from("org_members")
    .select("id")
    .eq("org_id", meeting.org_id)
    .eq("user_id", user.id)
    .single();
  if (!membership) throw new Error("Sin acceso");

  return { user, meeting, supabase };
}

Deno.serve(async (req) => {
  // CORS handling
  const corsCheck = handleCorsPreflightOrForbidden(req);
  if (corsCheck) return corsCheck;
  const corsHeaders = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { meeting_id } = await req.json();
    if (!meeting_id) {
      return new Response(JSON.stringify({ error: "Falta meeting_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({
          error: "missing_openai_key",
          how_to_fix: "Agrega OPENAI_API_KEY en Supabase Edge Function Secrets",
        }),
        { status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { user, meeting, supabase } = await verifyUserAndMeeting(
      supabaseUrl, serviceKey, authHeader, meeting_id
    );

    // Rate limit: 3 STT requests per minute per user
    const rl = checkRateLimit(user.id, "stt", 3, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec, corsHeaders);

    // Get latest audio
    const { data: audio } = await supabase
      .from("meeting_audio")
      .select("*")
      .eq("meeting_id", meeting_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!audio) {
      return new Response(JSON.stringify({ error: "No se encontró audio para esta reunión" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download audio from storage
    const { data: audioBlob, error: dlError } = await supabase.storage
      .from("meeting-audio")
      .download(audio.storage_path);

    if (dlError || !audioBlob) {
      console.error("Download error:", dlError);
      return new Response(JSON.stringify({ error: "Error al descargar audio" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get provider settings
    const { data: provSettings } = await supabase
      .from("org_provider_settings")
      .select("*")
      .eq("org_id", meeting.org_id)
      .single();

    const sttModel = provSettings?.stt_model || "gpt-4o-transcribe";
    const language = meeting.language || "es";

    // Update status
    await supabase.from("meetings").update({ status: "uploaded" }).eq("id", meeting_id);

    // Call OpenAI transcription
    const formData = new FormData();
    const fileName = audio.storage_path.split("/").pop() || "audio.webm";
    formData.append("file", new File([audioBlob], fileName, { type: audio.mime_type || "audio/webm" }));
    formData.append("model", sttModel);
    formData.append("language", language.split("-")[0]);
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");

    console.log(`Calling OpenAI STT with model=${sttModel}, language=${language}`);

    const sttResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
    });

    if (!sttResponse.ok) {
      const errText = await sttResponse.text();
      console.error("OpenAI STT error:", sttResponse.status, errText);
      await supabase.from("meetings").update({ status: "error" }).eq("id", meeting_id);
      return new Response(
        JSON.stringify({ error: `Error de transcripción: ${sttResponse.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sttResult = await sttResponse.json();
    console.log("STT result keys:", Object.keys(sttResult));

    // Parse segments
    const rawSegments: DiarizedSegment[] = [];
    const segments = sttResult.segments || [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      rawSegments.push({
        speaker: seg.speaker || `SPEAKER_${(seg.id ?? i) % 10}`,
        start: seg.start ?? 0,
        end: seg.end ?? 0,
        text: (seg.text || "").trim(),
      });
    }

    if (rawSegments.length === 0 && sttResult.text) {
      rawSegments.push({
        speaker: "SPEAKER_0",
        start: 0,
        end: sttResult.duration || 0,
        text: sttResult.text,
      });
    }

    // Get latest transcript version
    const { data: latestTranscript } = await supabase
      .from("meeting_transcripts")
      .select("version")
      .eq("meeting_id", meeting_id)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    const newVersion = (latestTranscript?.version || 0) + 1;

    // Insert transcript
    const { data: transcript, error: txError } = await supabase
      .from("meeting_transcripts")
      .insert({
        meeting_id,
        version: newVersion,
        provider: "openai",
        stt_model: sttModel,
        transcript_text: sttResult.text || rawSegments.map((s) => s.text).join(" "),
        diarization_json: sttResult,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (txError || !transcript) {
      console.error("Transcript insert error:", txError);
      return new Response(JSON.stringify({ error: "Error al guardar transcripción" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert segments
    if (rawSegments.length > 0) {
      const segmentRows = rawSegments.map((seg, idx) => ({
        meeting_id,
        transcript_id: transcript.id,
        segment_index: idx,
        speaker_label: seg.speaker,
        t_start_sec: seg.start,
        t_end_sec: seg.end,
        text: seg.text,
      }));

      const { error: segError } = await supabase.from("meeting_segments").insert(segmentRows);
      if (segError) console.error("Segments insert error:", segError);
    }

    // Get existing speaker renames
    const { data: speakers } = await supabase
      .from("meeting_speakers")
      .select("speaker_label, speaker_name")
      .eq("meeting_id", meeting_id);

    const speakerMap: Record<string, string> = {};
    if (speakers) {
      for (const s of speakers) speakerMap[s.speaker_label] = s.speaker_name;
    }

    // Update meeting status
    await supabase.from("meetings").update({ status: "transcribed" }).eq("id", meeting_id);

    // Log usage with duration
    const durationSec = sttResult.duration || audio.duration_sec || 0;
    const durationMin = Math.ceil(durationSec / 60);
    await supabase.from("usage_events").insert({
      org_id: meeting.org_id,
      meeting_id,
      kind: "stt",
      provider: "openai",
      model: sttModel,
      units: { duration_sec: durationSec, duration_min: durationMin },
      cost_estimate_usd: null,
    });

    return new Response(
      JSON.stringify({
        transcript_id: transcript.id,
        version: newVersion,
        segments_count: rawSegments.length,
        duration: sttResult.duration,
        speaker_map: speakerMap,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("STT error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
