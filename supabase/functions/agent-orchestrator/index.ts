import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, handleCorsPreflightOrForbidden } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

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

interface AgentProfile {
  id: string;
  name: string;
  role: string;
  system_prompt: string;
  output_schema_json: Record<string, unknown> | null;
  order_index: number;
  enabled: boolean;
  sector_id: string;
}

// ── Auth ────────────────────────────────────────────────────────────────

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

// ── Segments ────────────────────────────────────────────────────────────

async function getLatestTranscriptId(
  supabase: ReturnType<typeof createClient>,
  meetingId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("meeting_transcripts")
    .select("id")
    .eq("meeting_id", meetingId)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  return data?.id || null;
}

async function getRelevantSegments(
  supabase: ReturnType<typeof createClient>,
  meetingId: string,
  query?: string,
  limit = 60
): Promise<Segment[]> {
  const transcriptId = await getLatestTranscriptId(supabase, meetingId);
  if (!transcriptId) return [];

  if (query) {
    const tsQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `${w}:*`)
      .join(" & ");

    const { data } = await supabase
      .from("meeting_segments")
      .select("id, segment_index, speaker_label, speaker_name, t_start_sec, t_end_sec, text")
      .eq("meeting_id", meetingId)
      .eq("transcript_id", transcriptId)
      .textSearch("text_search", tsQuery, { config: "spanish" })
      .order("t_start_sec")
      .limit(limit);

    if (data && data.length > 0) return data;
  }

  const { data } = await supabase
    .from("meeting_segments")
    .select("id, segment_index, speaker_label, speaker_name, t_start_sec, t_end_sec, text")
    .eq("meeting_id", meetingId)
    .eq("transcript_id", transcriptId)
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

// ── LLM ─────────────────────────────────────────────────────────────────

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

  // Newer OpenAI models (gpt-4o, gpt-5, o-series) use max_completion_tokens
  const usesNewParam = /^(gpt-4o|gpt-5|o[1-9])/.test(model);
  const body: Record<string, unknown> = {
    model, messages, temperature,
    ...(usesNewParam ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
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

function buildAgentSystemPrompt(agent: AgentProfile): string {
  let prompt = agent.system_prompt;
  if (agent.output_schema_json) {
    prompt += `\n\nOUTPUT SCHEMA (tu respuesta JSON debe seguir exactamente esta estructura):\n${JSON.stringify(agent.output_schema_json, null, 2)}`;
    prompt += `\n\nIMPORTANTE: Responde SOLO con JSON válido que siga el schema anterior. Sin texto adicional fuera del JSON.`;
  }
  return prompt;
}

async function callLLMWithRetry(
  openaiKey: string, model: string, temperature: number, maxTokens: number,
  systemPrompt: string, userContent: string
): Promise<{ parsed: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number } }> {
  const result = await callLLM(openaiKey, model, temperature, maxTokens, systemPrompt, userContent, true);

  try {
    return { parsed: JSON.parse(result.content), usage: result.usage };
  } catch {
    console.warn("JSON parse failed, retrying with repair prompt...");
    const repairPrompt = `${systemPrompt}\n\nTu respuesta anterior no fue JSON válido. Devuelve SOLO JSON válido que siga el schema.`;
    const retryResult = await callLLM(openaiKey, model, temperature, maxTokens, repairPrompt, userContent, true);
    const totalUsage = {
      input_tokens: result.usage.input_tokens + retryResult.usage.input_tokens,
      output_tokens: result.usage.output_tokens + retryResult.usage.output_tokens,
    };
    try {
      return { parsed: JSON.parse(retryResult.content), usage: totalUsage };
    } catch {
      console.error("JSON parse failed after retry");
      return { parsed: { raw: retryResult.content, error: "JSON inválido después de retry" }, usage: totalUsage };
    }
  }
}

// ── Main Handler ────────────────────────────────────────────────────────

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

    const { meeting_id, mode, user_question } = await req.json();
    if (!meeting_id || !mode) {
      return new Response(JSON.stringify({ error: "Faltan parámetros: meeting_id, mode" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "missing_openai_key", how_to_fix: "Agrega OPENAI_API_KEY en Supabase Edge Function Secrets" }),
        { status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { user, meeting, supabase } = await verifyAuth(supabaseUrl, serviceKey, authHeader, meeting_id);

    // Rate limit: analyze=5/min, chat=10/min
    const rlAction = mode === "analyze" ? "analyze" : "chat";
    const rlMax = mode === "analyze" ? 5 : 10;
    const rl = checkRateLimit(user.id, rlAction, rlMax, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec, corsHeaders);

    // Get provider settings
    const { data: provSettings } = await supabase
      .from("org_provider_settings").select("*").eq("org_id", meeting.org_id).single();

    const llmModel = provSettings?.llm_model || "gpt-4o";
    const temperature = provSettings?.temperature || 0.2;
    const maxTokens = provSettings?.max_output_tokens || 1200;

    // Get speaker renames
    const { data: speakers } = await supabase
      .from("meeting_speakers").select("speaker_label, speaker_name").eq("meeting_id", meeting_id);
    const speakerMap: Record<string, string> = {};
    if (speakers) for (const s of speakers) speakerMap[s.speaker_label] = s.speaker_name;

    // Get sector info
    const { data: sector } = await supabase
      .from("sectors").select("key, name, description").eq("id", meeting.sector_id).single();

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    if (mode === "analyze") {
      return await handleAnalyze({
        supabase, meetingId: meeting_id, meeting, user, sector, speakerMap,
        openaiKey, llmModel, temperature, maxTokens, totalInputTokens, totalOutputTokens, corsHeaders,
      });
    } else if (mode === "chat") {
      return await handleChat({
        supabase, meetingId: meeting_id, meeting, user, speakerMap,
        openaiKey, llmModel, temperature, maxTokens, userQuestion: user_question,
        totalInputTokens, totalOutputTokens, corsHeaders,
      });
    } else {
      return new Response(JSON.stringify({ error: "Modo no válido. Usa 'analyze' o 'chat'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("Orchestrator error:", err);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Analyze Mode ────────────────────────────────────────────────────────

interface AnalyzeParams {
  supabase: ReturnType<typeof createClient>;
  meetingId: string;
  meeting: Record<string, unknown>;
  user: { id: string };
  sector: { key: string; name: string; description: string | null } | null;
  speakerMap: Record<string, string>;
  openaiKey: string;
  llmModel: string;
  temperature: number;
  maxTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  corsHeaders: Record<string, string>;
}

async function handleAnalyze(p: AnalyzeParams): Promise<Response> {
  const { supabase, meetingId, meeting, user, sector, speakerMap, openaiKey, llmModel, temperature, maxTokens, corsHeaders } = p;
  let totalInputTokens = p.totalInputTokens;
  let totalOutputTokens = p.totalOutputTokens;

  const { data: agents } = await supabase
    .from("agent_profiles").select("*")
    .eq("sector_id", meeting.sector_id as string).eq("enabled", true).order("order_index");

  if (!agents || agents.length === 0) {
    return new Response(JSON.stringify({ error: "No hay agentes configurados para este sector" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const coordinator = agents.find((a: AgentProfile) => a.role === "coordinator") as AgentProfile | undefined;
  const specialists = agents.filter((a: AgentProfile) => a.role === "specialist") as AgentProfile[];

  if (!coordinator) {
    return new Response(JSON.stringify({ error: "No hay coordinador configurado" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const segments = await getRelevantSegments(supabase, meetingId);
  const transcriptText = formatSegmentsForPrompt(segments, speakerMap);

  if (segments.length === 0) {
    return new Response(
      JSON.stringify({ error: "No hay segmentos de transcripción disponibles. Primero transcribe el audio." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Run specialists in parallel
  const specialistPromises = specialists.map(async (spec) => {
    const systemPrompt = buildAgentSystemPrompt(spec);
    const userContent = `Sector: ${sector?.name || "General"}
Reunión: ${meeting.title}
${(meeting.notes as string) ? `Notas: ${meeting.notes}` : ""}

TRANSCRIPCIÓN DIARIZADA:
${transcriptText}

Tu foco: ${spec.name}
Produce tu análisis en JSON según el schema proporcionado.`;

    const result = await callLLMWithRetry(openaiKey, llmModel, temperature, maxTokens, systemPrompt, userContent);
    totalInputTokens += result.usage.input_tokens;
    totalOutputTokens += result.usage.output_tokens;
    return { agent: spec.name, output: result.parsed };
  });

  const specialistResults = await Promise.all(specialistPromises);

  // Coordinator consolidation
  const coordSystemPrompt = buildAgentSystemPrompt(coordinator);
  const consolidationContent = `Sector: ${sector?.name || "General"}
Reunión: ${meeting.title}
${(meeting.notes as string) ? `Notas: ${meeting.notes}` : ""}

TRANSCRIPCIÓN DIARIZADA:
${transcriptText}

RESULTADOS DE ESPECIALISTAS:
${specialistResults.map((r) => `--- ${r.agent} ---\n${JSON.stringify(r.output, null, 2)}`).join("\n\n")}

Consolida los resultados en el JSON final según el schema de coordinador.`;

  const coordResult = await callLLMWithRetry(openaiKey, llmModel, temperature, maxTokens * 3, coordSystemPrompt, consolidationContent);
  totalInputTokens += coordResult.usage.input_tokens;
  totalOutputTokens += coordResult.usage.output_tokens;

  const analysisJson = coordResult.parsed;
  console.log("Coordinator result keys:", Object.keys(analysisJson));
  console.log("Coordinator result preview:", JSON.stringify(analysisJson).substring(0, 500));

  // Save analysis
  const { data: latestAnalysis } = await supabase
    .from("meeting_analyses").select("version").eq("meeting_id", meetingId)
    .order("version", { ascending: false }).limit(1).single();

  const newVersion = (latestAnalysis?.version || 0) + 1;

  // Build agent_runs for observability
  const agentRuns = specialistResults.map((r) => ({
    agent: r.agent,
    role: "specialist",
    output: r.output,
  }));
  agentRuns.push({ agent: coordinator.name, role: "coordinator", output: analysisJson });

  const { data: analysis, error: analysisError } = await supabase
    .from("meeting_analyses")
    .insert({
      meeting_id: meetingId, version: newVersion, sector_id: meeting.sector_id as string,
      analysis_json: analysisJson, created_by: user.id,
      agent_runs: agentRuns,
    })
    .select("id").single();

  if (analysisError) console.error("Analysis insert error:", analysisError);

  await supabase.from("meetings").update({ status: "analyzed" }).eq("id", meetingId);

  // Log usage
  await supabase.from("usage_events").insert({
    org_id: meeting.org_id as string, meeting_id: meetingId,
    kind: "llm", provider: "openai", model: llmModel,
    units: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    cost_estimate_usd: null,
  });

  return new Response(
    JSON.stringify({ analysis_id: analysis?.id, version: newVersion, analysis: analysisJson }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ── Chat Mode ───────────────────────────────────────────────────────────

interface ChatParams {
  supabase: ReturnType<typeof createClient>;
  meetingId: string;
  meeting: Record<string, unknown>;
  user: { id: string };
  speakerMap: Record<string, string>;
  openaiKey: string;
  llmModel: string;
  temperature: number;
  maxTokens: number;
  userQuestion: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  corsHeaders: Record<string, string>;
}

async function handleChat(p: ChatParams): Promise<Response> {
  const { supabase, meetingId, meeting, user, speakerMap, openaiKey, llmModel, temperature, maxTokens, userQuestion, corsHeaders } = p;
  let totalInputTokens = p.totalInputTokens;
  let totalOutputTokens = p.totalOutputTokens;

  if (!userQuestion) {
    return new Response(JSON.stringify({ error: "Falta user_question para modo chat" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Save user message
  await supabase.from("chat_messages").insert({
    meeting_id: meetingId, user_id: user.id, role: "user", content: userQuestion,
  });

  // Retrieve relevant segments
  const segments = await getRelevantSegments(supabase, meetingId, userQuestion, 30);
  const transcriptText = formatSegmentsForPrompt(segments, speakerMap);

  // Get latest analysis summary if available
  const { data: latestAnalysis } = await supabase
    .from("meeting_analyses").select("analysis_json").eq("meeting_id", meetingId)
    .order("version", { ascending: false }).limit(1).single();

  let analysisSummary = "";
  if (latestAnalysis?.analysis_json) {
    const aj = latestAnalysis.analysis_json as Record<string, unknown>;
    if (aj.summary) analysisSummary = `\nRESUMEN DEL ANÁLISIS PREVIO:\n${aj.summary}\n`;
  }

  // Get recent chat history
  const { data: recentMessages } = await supabase
    .from("chat_messages").select("role, content").eq("meeting_id", meetingId)
    .order("created_at", { ascending: false }).limit(10);

  const chatHistory = (recentMessages || [])
    .reverse()
    .map((m: { role: string; content: string }) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content}`)
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

PREGUNTA DEL USUARIO: ${userQuestion}`;

  const result = await callLLM(openaiKey, llmModel, temperature, maxTokens, systemPrompt, userContent, false);
  totalInputTokens += result.usage.input_tokens;
  totalOutputTokens += result.usage.output_tokens;

  // Save assistant message
  const { data: assistantMsg } = await supabase
    .from("chat_messages")
    .insert({
      meeting_id: meetingId, user_id: user.id, role: "assistant", content: result.content,
      evidence_json: segments.slice(0, 5).map((s) => ({
        speaker: speakerMap[s.speaker_label] || s.speaker_name || s.speaker_label,
        t_start_sec: s.t_start_sec, t_end_sec: s.t_end_sec, quote: s.text.substring(0, 150),
      })),
    })
    .select("id, content, evidence_json, created_at").single();

  // Log usage
  await supabase.from("usage_events").insert({
    org_id: meeting.org_id as string, meeting_id: meetingId,
    kind: "llm", provider: "openai", model: llmModel,
    units: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    cost_estimate_usd: null,
  });

  return new Response(JSON.stringify({ message: assistantMsg }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
