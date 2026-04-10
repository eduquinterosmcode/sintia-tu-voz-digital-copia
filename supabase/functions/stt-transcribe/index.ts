import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, handleCorsPreflightOrForbidden } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

interface DiarizedSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

// ── Embeddings ───────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_BATCH_SIZE = 500; // well under OpenAI's 2048 limit

async function generateEmbeddings(openaiKey: string, texts: string[]): Promise<number[][]> {
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);

    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });

    if (!res.ok) throw new Error(`Embeddings API error: ${res.status}`);

    const data = await res.json();
    // Sort by index to guarantee order matches input
    const sorted = (data.data as Array<{ index: number; embedding: number[] }>)
      .sort((a, b) => a.index - b.index);
    allEmbeddings.push(...sorted.map((item) => item.embedding));
  }

  return allEmbeddings;
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

    // Files > 25 MB cannot be sent directly to Whisper — route to Python chunked worker
    const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
    if (audioBlob.size > WHISPER_MAX_BYTES) {
      const sizeMb = (audioBlob.size / (1024 * 1024)).toFixed(1);
      console.log(`Audio (${sizeMb} MB) exceeds Whisper limit — enqueuing chunked transcription job`);

      const { error: jobError } = await supabase
        .from("ai_jobs")
        .upsert(
          {
            job_type: "transcribe_audio",
            payload: {
              meeting_id,
              storage_path: `meeting-audio/${audio.storage_path}`,
              mime_type: audio.mime_type || "audio/webm",
              language: meeting.language || "es",
              stt_model: "whisper-1",
              user_id: user.id,
              org_id: meeting.org_id,
            },
            status: "pending",
            idempotency_key: `transcribe_audio:${meeting_id}`,
            max_attempts: 3,
          },
          { onConflict: "idempotency_key", ignoreDuplicates: true }
        );

      if (jobError) {
        console.error("Failed to enqueue transcribe_audio job:", jobError);
        await supabase.from("meetings").update({ status: "error" }).eq("id", meeting_id);
        return new Response(
          JSON.stringify({ error: "Error al encolar la transcripción", detail: jobError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // "transcribing" is in PROCESSING_STATUSES — the frontend polls automatically
      await supabase.from("meetings").update({ status: "transcribing" }).eq("id", meeting_id);

      // Wake up Cloud Run worker (min-instances=0 — instance may be sleeping).
      // Fire-and-forget: if the ping fails the job will be picked up on the next poll cycle.
      const aiServiceUrl = Deno.env.get("AI_SERVICE_URL");
      if (aiServiceUrl) {
        fetch(`${aiServiceUrl}/health`).catch((e) =>
          console.warn("Cloud Run wake-up ping failed (non-fatal):", e)
        );
      }

      return new Response(
        JSON.stringify({
          queued: true,
          message: `Reunión de ${sizeMb} MB en cola. La transcripción puede tomar varios minutos — aparecerá automáticamente cuando esté lista.`,
          size_mb: parseFloat(sizeMb),
        }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get provider settings
    const { data: provSettings } = await supabase
      .from("org_provider_settings")
      .select("*")
      .eq("org_id", meeting.org_id)
      .single();

    const sttModel = provSettings?.stt_model || "whisper-1";
    const language = meeting.language || "es";
    const isWhisper = sttModel.startsWith("whisper");

    // Update status
    await supabase.from("meetings").update({ status: "uploaded" }).eq("id", meeting_id);

    // Call OpenAI transcription
    const formData = new FormData();
    const fileName = audio.storage_path.split("/").pop() || "audio.webm";
    formData.append("file", new File([audioBlob], fileName, { type: audio.mime_type || "audio/webm" }));
    formData.append("model", sttModel);
    formData.append("language", language.split("-")[0]);
    // gpt-4o-transcribe only supports "json" or "text"; whisper supports "verbose_json"
    formData.append("response_format", isWhisper ? "verbose_json" : "json");
    if (isWhisper) {
      formData.append("timestamp_granularities[]", "segment");
    }

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

    // Insert segments (with embeddings when possible)
    if (rawSegments.length > 0) {
      // Generate embeddings non-fatally — if this fails, segments insert without
      // embeddings and the chat RAG falls back to full-text search automatically.
      let embeddings: number[][] | null = null;
      try {
        const texts = rawSegments.map((s) => s.text);
        embeddings = await generateEmbeddings(openaiKey, texts);
        console.log(`Generated ${embeddings.length} embeddings for ${rawSegments.length} segments`);
      } catch (embErr) {
        console.warn("Embedding generation failed — inserting segments without embeddings:", embErr);
      }

      const segmentRows = rawSegments.map((seg, idx) => ({
        meeting_id,
        transcript_id: transcript.id,
        segment_index: idx,
        speaker_label: seg.speaker,
        t_start_sec: seg.start,
        t_end_sec: seg.end,
        text: seg.text,
        ...(embeddings ? { embedding: embeddings[idx] } : {}),
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
