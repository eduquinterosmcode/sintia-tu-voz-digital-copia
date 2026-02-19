import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Evidence {
  speaker: string;
  t_start_sec: number;
  t_end_sec: number;
  quote: string;
}

interface Segment {
  id: string;
  segment_index: number;
  speaker_label: string;
  speaker_name: string | null;
  t_start_sec: number;
  t_end_sec: number;
  text: string;
}

async function verifyAuth(supabaseUrl: string, serviceKey: string, authHeader: string, meetingId: string) {
  const supabaseAuth = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) throw new Error("No autorizado");

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, org_id, sector_id, title, notes, language")
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

async function getRelevantSegments(
  supabase: ReturnType<typeof createClient>,
  meetingId: string,
  query?: string,
  limit = 60
): Promise<Segment[]> {
  if (query) {
    // Full-text search
    const tsQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `${w}:*`)
      .join(" & ");

    const { data } = await supabase
      .from("meeting_segments")
      .select("id, segment_index, speaker_label, speaker_name, t_start_sec, t_end_sec, text")
      .eq("meeting_id", meetingId)
      .textSearch("text_search", tsQuery, { config: "spanish" })
      .order("t_start_sec")
      .limit(limit);

    if (data && data.length > 0) return data;
  }

  // Fallback: get all segments (limited)
  const { data } = await supabase
    .from("meeting_segments")
    .select("id, segment_index, speaker_label, speaker_name, t_start_sec, t_end_sec, text")
    .eq("meeting_id", meetingId)
    .order("t_start_sec")
    .limit(limit);

  return data || [];
}

function formatSegmentsForPrompt(segments: Segment[], speakerMap: Record<string, string>): string {
  return segments
    .map((s) => {
      const name = speakerMap[s.speaker_label] || s.speaker_name || s.speaker_label;
      const start = formatTime(s.t_start_sec);
      const end = formatTime(s.t_end_sec);
      return `[${start}-${end}] ${name}: ${s.text}`;
    })
    .join("\n");
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function callLLM(
  openaiKey: string,
  model: string,
  temperature: number,
  maxTokens: number,
  systemPrompt: string,
  userContent: string,
  jsonMode = true
): Promise<{ content: string; usage: { input_tokens: number; output_tokens: number } }> {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("LLM error:", res.status, errText);
    throw new Error(`Error LLM: ${res.status}`);
  }

  const data = await res.json();
  return {
    content: data.choices[0]?.message?.content || "{}",
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  };
}

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

    const { meeting_id, mode, user_question } = await req.json();
    if (!meeting_id || !mode) {
      return new Response(JSON.stringify({ error: "Faltan parámetros: meeting_id, mode" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("Openai SintIA Test");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "API key de OpenAI no configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user, meeting, supabase } = await verifyAuth(supabaseUrl, serviceKey, authHeader, meeting_id);

    // Get provider settings
    const { data: provSettings } = await supabase
      .from("org_provider_settings")
      .select("*")
      .eq("org_id", meeting.org_id)
      .single();

    const llmModel = provSettings?.llm_model || "gpt-4o";
    const temperature = provSettings?.temperature || 0.2;
    const maxTokens = provSettings?.max_output_tokens || 1200;

    // Get speaker renames
    const { data: speakers } = await supabase
      .from("meeting_speakers")
      .select("speaker_label, speaker_name")
      .eq("meeting_id", meeting_id);

    const speakerMap: Record<string, string> = {};
    if (speakers) {
      for (const s of speakers) {
        speakerMap[s.speaker_label] = s.speaker_name;
      }
    }

    // Get sector info
    const { data: sector } = await supabase
      .from("sectors")
      .select("key, name, description")
      .eq("id", meeting.sector_id)
      .single();

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    if (mode === "analyze") {
      // Get agent profiles for sector
      const { data: agents } = await supabase
        .from("agent_profiles")
        .select("*")
        .eq("sector_id", meeting.sector_id)
        .eq("enabled", true)
        .order("order_index");

      if (!agents || agents.length === 0) {
        return new Response(
          JSON.stringify({ error: "No hay agentes configurados para este sector" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const coordinator = agents.find((a) => a.role === "coordinator");
      const specialists = agents.filter((a) => a.role === "specialist");

      if (!coordinator) {
        return new Response(
          JSON.stringify({ error: "No hay coordinador configurado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get segments
      const segments = await getRelevantSegments(supabase, meeting_id);
      const transcriptText = formatSegmentsForPrompt(segments, speakerMap);

      if (segments.length === 0) {
        return new Response(
          JSON.stringify({ error: "No hay segmentos de transcripción disponibles. Primero transcribe el audio." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Step 1: Run specialists in parallel
      const specialistPromises = specialists.map(async (spec) => {
        const userContent = `Sector: ${sector?.name || "General"}
Reunión: ${meeting.title}
${meeting.notes ? `Notas: ${meeting.notes}` : ""}

TRANSCRIPCIÓN DIARIZADA:
${transcriptText}

Tu foco: ${spec.name}
Produce tu análisis en JSON según el schema proporcionado.`;

        const result = await callLLM(
          openaiKey,
          llmModel,
          temperature,
          maxTokens,
          spec.system_prompt,
          userContent,
          true
        );

        totalInputTokens += result.usage.input_tokens;
        totalOutputTokens += result.usage.output_tokens;

        let parsed;
        try {
          parsed = JSON.parse(result.content);
        } catch {
          parsed = { specialist_name: spec.name, findings: [], risks: [], raw: result.content };
        }

        return { agent: spec.name, output: parsed };
      });

      const specialistResults = await Promise.all(specialistPromises);

      // Step 2: Coordinator consolidation
      const consolidationContent = `Sector: ${sector?.name || "General"}
Reunión: ${meeting.title}
${meeting.notes ? `Notas: ${meeting.notes}` : ""}

TRANSCRIPCIÓN DIARIZADA:
${transcriptText}

RESULTADOS DE ESPECIALISTAS:
${specialistResults.map((r) => `--- ${r.agent} ---\n${JSON.stringify(r.output, null, 2)}`).join("\n\n")}

Consolida los resultados en el JSON final según el schema de coordinador.`;

      const coordResult = await callLLM(
        openaiKey,
        llmModel,
        temperature,
        maxTokens * 2,
        coordinator.system_prompt,
        consolidationContent,
        true
      );

      totalInputTokens += coordResult.usage.input_tokens;
      totalOutputTokens += coordResult.usage.output_tokens;

      let analysisJson;
      try {
        analysisJson = JSON.parse(coordResult.content);
      } catch {
        analysisJson = { raw: coordResult.content, error: "No se pudo parsear JSON" };
      }

      // Save analysis
      const { data: latestAnalysis } = await supabase
        .from("meeting_analyses")
        .select("version")
        .eq("meeting_id", meeting_id)
        .order("version", { ascending: false })
        .limit(1)
        .single();

      const newVersion = (latestAnalysis?.version || 0) + 1;

      const { data: analysis, error: analysisError } = await supabase
        .from("meeting_analyses")
        .insert({
          meeting_id,
          version: newVersion,
          sector_id: meeting.sector_id,
          analysis_json: analysisJson,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (analysisError) {
        console.error("Analysis insert error:", analysisError);
      }

      // Update meeting status
      await supabase
        .from("meetings")
        .update({ status: "analyzed" })
        .eq("id", meeting_id);

      // Log usage
      await supabase.from("usage_events").insert({
        org_id: meeting.org_id,
        meeting_id,
        kind: "llm",
        provider: "openai",
        model: llmModel,
        units: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
        cost_estimate_usd: null,
      });

      return new Response(
        JSON.stringify({
          analysis_id: analysis?.id,
          version: newVersion,
          analysis: analysisJson,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else if (mode === "chat") {
      if (!user_question) {
        return new Response(JSON.stringify({ error: "Falta user_question para modo chat" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Save user message
      await supabase.from("chat_messages").insert({
        meeting_id,
        user_id: user.id,
        role: "user",
        content: user_question,
      });

      // Retrieve relevant segments
      const segments = await getRelevantSegments(supabase, meeting_id, user_question, 30);
      const transcriptText = formatSegmentsForPrompt(segments, speakerMap);

      // Get latest analysis summary if available
      const { data: latestAnalysis } = await supabase
        .from("meeting_analyses")
        .select("analysis_json")
        .eq("meeting_id", meeting_id)
        .order("version", { ascending: false })
        .limit(1)
        .single();

      let analysisSummary = "";
      if (latestAnalysis?.analysis_json) {
        const aj = latestAnalysis.analysis_json as Record<string, unknown>;
        if (aj.summary) {
          analysisSummary = `\nRESUMEN DEL ANÁLISIS PREVIO:\n${aj.summary}\n`;
        }
      }

      // Get recent chat history
      const { data: recentMessages } = await supabase
        .from("chat_messages")
        .select("role, content")
        .eq("meeting_id", meeting_id)
        .order("created_at", { ascending: false })
        .limit(10);

      const chatHistory = (recentMessages || [])
        .reverse()
        .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content}`)
        .join("\n");

      const systemPrompt = `Eres SintIA, asistente profesional de reuniones. Responde en español (Chile).
Basa tus respuestas ÚNICAMENTE en los segmentos de transcripción proporcionados.
Para afirmaciones importantes, incluye citas de evidencia con el formato: [Speaker, MM:SS-MM:SS].
Si la información no está en la transcripción, dilo explícitamente.
Sé conciso, profesional y accionable.`;

      const userContent = `SEGMENTOS RELEVANTES DE LA TRANSCRIPCIÓN:
${transcriptText}
${analysisSummary}
HISTORIAL RECIENTE:
${chatHistory}

PREGUNTA DEL USUARIO: ${user_question}`;

      const result = await callLLM(openaiKey, llmModel, temperature, maxTokens, systemPrompt, userContent, false);

      totalInputTokens += result.usage.input_tokens;
      totalOutputTokens += result.usage.output_tokens;

      // Save assistant message
      const { data: assistantMsg } = await supabase
        .from("chat_messages")
        .insert({
          meeting_id,
          user_id: user.id,
          role: "assistant",
          content: result.content,
          evidence_json: segments.slice(0, 5).map((s) => ({
            speaker: speakerMap[s.speaker_label] || s.speaker_name || s.speaker_label,
            t_start_sec: s.t_start_sec,
            t_end_sec: s.t_end_sec,
            quote: s.text.substring(0, 150),
          })),
        })
        .select("id, content, evidence_json, created_at")
        .single();

      // Log usage
      await supabase.from("usage_events").insert({
        org_id: meeting.org_id,
        meeting_id,
        kind: "llm",
        provider: "openai",
        model: llmModel,
        units: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
        cost_estimate_usd: null,
      });

      return new Response(JSON.stringify({ message: assistantMsg }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({ error: "Modo no válido. Usa 'analyze' o 'chat'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("Orchestrator error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
