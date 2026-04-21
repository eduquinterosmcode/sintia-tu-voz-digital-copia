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

interface ActivationRules {
  mode: "always" | "keyword" | "segment_count";
  keywords?: string[];
  min_matches?: number;
  min_segments?: number;
}

interface AgentProfile {
  id: string;
  name: string;
  role: string;
  system_prompt: string;
  output_schema_json: Record<string, unknown> | null;
  activation_rules: ActivationRules | null;
  order_index: number;
  enabled: boolean;
  sector_id: string;
}

// ── Activation Rules ─────────────────────────────────────────────────────

function shouldActivateSpecialist(
  agent: AgentProfile,
  segments: Segment[],
  transcriptText: string
): boolean {
  const rules = agent.activation_rules;

  // No rules or mode=always → always activate
  if (!rules || rules.mode === "always") return true;

  if (rules.mode === "segment_count") {
    const min = rules.min_segments ?? 1;
    const active = segments.length >= min;
    if (!active) console.log(`Specialist "${agent.name}" skipped: segment_count ${segments.length} < ${min}`);
    return active;
  }

  if (rules.mode === "keyword") {
    const keywords = rules.keywords ?? [];
    const minMatches = rules.min_matches ?? 1;
    const lowerText = transcriptText.toLowerCase();
    const matches = keywords.filter((kw) => lowerText.includes(kw.toLowerCase()));
    const active = matches.length >= minMatches;
    if (!active) console.log(`Specialist "${agent.name}" skipped: keyword matches ${matches.length}/${minMatches} required`);
    else console.log(`Specialist "${agent.name}" activated by keywords: [${matches.join(", ")}]`);
    return active;
  }

  // Unknown mode → activate by default (fail-open)
  console.warn(`Specialist "${agent.name}" has unknown activation_rules.mode="${rules.mode}" — activating by default`);
  return true;
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

async function getQueryEmbedding(openaiKey: string, query: string): Promise<number[] | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function getRelevantSegments(
  supabase: ReturnType<typeof createClient>,
  meetingId: string,
  openaiKey: string,
  query?: string,
  limit = 60
): Promise<Segment[]> {
  const transcriptId = await getLatestTranscriptId(supabase, meetingId);
  if (!transcriptId) return [];

  if (query) {
    // ── Level 1: vector similarity search ──
    const queryEmbedding = await getQueryEmbedding(openaiKey, query);
    if (queryEmbedding) {
      const { data: vectorResults } = await supabase.rpc("match_meeting_segments", {
        p_meeting_id: meetingId,
        p_transcript_id: transcriptId,
        p_query_embedding: queryEmbedding,
        p_match_count: limit,
        p_min_similarity: 0.3,
      });
      if (vectorResults && vectorResults.length > 0) {
        console.log(`Vector search: ${vectorResults.length} segments (similarity ≥ 0.3)`);
        return vectorResults;
      }
      console.log("Vector search returned 0 results — falling back to full-text");
    }

    // ── Level 2: full-text search (for segments without embeddings) ──
    const tsQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `${w}:*`)
      .join(" & ");

    const { data: ftResults } = await supabase
      .from("meeting_segments")
      .select("id, segment_index, speaker_label, speaker_name, t_start_sec, t_end_sec, text")
      .eq("meeting_id", meetingId)
      .eq("transcript_id", transcriptId)
      .textSearch("text_search", tsQuery, { config: "spanish" })
      .order("t_start_sec")
      .limit(limit);

    if (ftResults && ftResults.length > 0) {
      console.log(`Full-text search: ${ftResults.length} segments`);
      return ftResults;
    }
  }

  // ── Level 3: chronological fallback ──
  const { data } = await supabase
    .from("meeting_segments")
    .select("id, segment_index, speaker_label, speaker_name, t_start_sec, t_end_sec, text")
    .eq("meeting_id", meetingId)
    .eq("transcript_id", transcriptId)
    .order("t_start_sec")
    .limit(limit);

  return data || [];
}

// ── All Segments (for Map-Reduce) ───────────────────────────────────────

async function getAllSegments(
  supabase: ReturnType<typeof createClient>,
  meetingId: string
): Promise<Segment[]> {
  const transcriptId = await getLatestTranscriptId(supabase, meetingId);
  if (!transcriptId) return [];

  const allSegments: Segment[] = [];
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await supabase
      .from("meeting_segments")
      .select("id, segment_index, speaker_label, speaker_name, t_start_sec, t_end_sec, text")
      .eq("meeting_id", meetingId)
      .eq("transcript_id", transcriptId)
      .order("t_start_sec")
      .range(offset, offset + pageSize - 1);

    if (data && data.length > 0) {
      allSegments.push(...data);
      offset += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  return allSegments;
}

const WINDOW_SIZE = 60;
const WINDOW_OVERLAP = 5;
const STEP = WINDOW_SIZE - WINDOW_OVERLAP;

// Si la última ventana quedaría demasiado pequeña, intentamos absorberla
// extendiendo la ventana anterior solo un poco.
const MIN_FINAL_WINDOW = Math.max(10, Math.floor(WINDOW_SIZE * 0.25)); // 15
const MAX_EXTENDED_WINDOW = WINDOW_SIZE + WINDOW_OVERLAP; // 65

function chunkSegments(segments: Segment[]): Segment[][] {
  if (segments.length === 0) return [];
  if (segments.length <= WINDOW_SIZE) return [segments];

  if (STEP <= 0) {
    throw new Error("WINDOW_OVERLAP debe ser menor que WINDOW_SIZE");
  }

  const windows: Segment[][] = [];
  const windowStarts: number[] = [];

  for (let start = 0; start < segments.length; start += STEP) {
    const remaining = segments.length - start;
    const end = Math.min(start + WINDOW_SIZE, segments.length);

    // Si el tramo final sería demasiado pequeño, intentamos absorberlo
    // extendiendo la ventana anterior de forma controlada.
    if (remaining < MIN_FINAL_WINDOW && windows.length > 0) {
      const prevStart = windowStarts[windowStarts.length - 1];
      const extendedPrev = segments.slice(prevStart, segments.length);

      if (extendedPrev.length <= MAX_EXTENDED_WINDOW) {
        windows[windows.length - 1] = extendedPrev;
        break;
      }
    }

    windows.push(segments.slice(start, end));
    windowStarts.push(start);

    if (end === segments.length) {
      break;
    }
  }

  return windows;
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

    const { meeting_id, mode, user_question, stream } = await req.json();
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
      const chatParams = {
        supabase, meetingId: meeting_id, meeting, user, speakerMap,
        openaiKey, llmModel, temperature, maxTokens, userQuestion: user_question,
        totalInputTokens, totalOutputTokens, corsHeaders,
      };
      return stream === true
        ? await handleChatStream(chatParams)
        : await handleChat(chatParams);
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

// Sectors handled by the Python ai-service (real agents via OpenAI Agents SDK).
// Add sector keys here as each sector is migrated. Deno handles everything else.
const PYTHON_AGENT_SECTORS = new Set<string>(["business"]);

async function handleAnalyze(p: AnalyzeParams): Promise<Response> {
  const { supabase, meetingId, meeting, user, sector, speakerMap, openaiKey, llmModel, temperature, maxTokens, corsHeaders } = p;
  let totalInputTokens = p.totalInputTokens;
  let totalOutputTokens = p.totalOutputTokens;

  // ── Route to Python ai-service for migrated sectors ─────────────────────
  if (sector?.key && PYTHON_AGENT_SECTORS.has(sector.key)) {
    const idempotencyKey = `analyze_meeting:${meetingId}:${Date.now()}`;
    const { error: jobError } = await supabase.from("ai_jobs").insert({
      idempotency_key: idempotencyKey,
      job_type: "analyze_meeting",
      payload: { meeting_id: meetingId },
      priority: 2,
      max_attempts: 2,
    });
    if (jobError) {
      console.error("Failed to enqueue analyze_meeting job:", jobError.message);
      return new Response(JSON.stringify({ error: "Error al encolar el análisis" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`Meeting ${meetingId} routed to Python agents (sector=${sector.key})`);
    return new Response(JSON.stringify({ queued: true, sector: sector.key }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

  const allSegments = await getAllSegments(supabase, meetingId);

  if (allSegments.length === 0) {
    return new Response(
      JSON.stringify({ error: "No hay segmentos de transcripción disponibles. Primero transcribe el audio." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Mark as analyzing so the frontend can poll status without blocking on the HTTP response.
  await supabase.from("meetings").update({ status: "analyzing" }).eq("id", meetingId);

  // ── Filter specialists by activation_rules ──────────────────────────
  const transcriptText = allSegments.map((s) => s.text).join(" ");
  const activeSpecialists = specialists.filter((spec) =>
    shouldActivateSpecialist(spec, allSegments, transcriptText)
  );

  // Fail-open: if all specialists were filtered out, use all of them
  const effectiveSpecialists = activeSpecialists.length > 0 ? activeSpecialists : specialists;
  if (activeSpecialists.length === 0) {
    console.warn("All specialists were filtered by activation_rules — falling back to all specialists");
  } else if (activeSpecialists.length < specialists.length) {
    console.log(`Activation rules: ${activeSpecialists.length}/${specialists.length} specialists active`);
  }

  const windows = chunkSegments(allSegments);
  const isMapReduce = windows.length > 1;
  console.log(`Analysis mode: ${isMapReduce ? "map-reduce" : "single-pass"}, segments: ${allSegments.length}, windows: ${windows.length}, active specialists: ${effectiveSpecialists.length}`);

  // ── MAP PHASE: run specialists on each window ──
  const windowResults: Array<{ windowIndex: number; specialistResults: Array<{ agent: string; output: Record<string, unknown> }> }> = [];

  for (let wi = 0; wi < windows.length; wi++) {
    const windowSegments = windows[wi];
    const windowText = formatSegmentsForPrompt(windowSegments, speakerMap);
    const windowLabel = isMapReduce
      ? ` (ventana ${wi + 1}/${windows.length}, segmentos ${windowSegments[0].segment_index}-${windowSegments[windowSegments.length - 1].segment_index})`
      : "";

    const specialistPromises = effectiveSpecialists.map(async (spec) => {
      const systemPrompt = buildAgentSystemPrompt(spec);
      const userContent = `Sector: ${sector?.name || "General"}
Reunión: ${meeting.title}${windowLabel}
${(meeting.notes as string) ? `Notas: ${meeting.notes}` : ""}

TRANSCRIPCIÓN DIARIZADA:
${windowText}

Tu foco: ${spec.name}
Produce tu análisis en JSON según el schema proporcionado.`;

      const result = await callLLMWithRetry(openaiKey, llmModel, temperature, maxTokens, systemPrompt, userContent);
      totalInputTokens += result.usage.input_tokens;
      totalOutputTokens += result.usage.output_tokens;

      // ── LOGGING DIAGNÓSTICO (nuevo) ──
      const outputKeys = Object.keys(result.parsed);
      console.log(`Specialist "${spec.name}" output keys: [${outputKeys.join(", ")}], key count: ${outputKeys.length}`);
      if (outputKeys.length === 0) {
        console.warn(`Specialist "${spec.name}" returned EMPTY output. Raw content length: ${JSON.stringify(result.parsed).length}`);
      }
      // ── FIN LOGGING ──

      return { agent: spec.name, output: result.parsed };
    });

    const results = await Promise.all(specialistPromises);
    windowResults.push({ windowIndex: wi, specialistResults: results });
  }

  // ── REDUCE PHASE: coordinator consolidates all windows ──
  const coordSystemPrompt = buildAgentSystemPrompt(coordinator);

  let consolidationContent: string;
  if (isMapReduce) {
    // Multi-window: present all window results grouped
    const windowSummaries = windowResults.map((wr) => {
      const windowSegments = windows[wr.windowIndex];
      const timeRange = `${formatTime(windowSegments[0].t_start_sec)} - ${formatTime(windowSegments[windowSegments.length - 1].t_end_sec)}`;
      const specialistTexts = wr.specialistResults
        .map((r) => `  --- ${r.agent} ---\n${JSON.stringify(r.output, null, 2)}`)
        .join("\n\n");
      return `=== VENTANA ${wr.windowIndex + 1}/${windows.length} [${timeRange}] ===\n${specialistTexts}`;
    }).join("\n\n");

    consolidationContent = `Sector: ${sector?.name || "General"}
Reunión: ${meeting.title}
${(meeting.notes as string) ? `Notas: ${meeting.notes}` : ""}

IMPORTANTE: Esta reunión tiene ${allSegments.length} segmentos divididos en ${windows.length} ventanas temporales.
Cada ventana fue analizada por especialistas de forma independiente.
Debes CONSOLIDAR y DEDUPLICAR los resultados, fusionando hallazgos repetidos entre ventanas y manteniendo la cobertura completa.

RESULTADOS POR VENTANA:
${windowSummaries}

Consolida TODOS los resultados en el JSON final según el schema de coordinador. Elimina duplicados, fusiona evidencia complementaria.`;
  } else {
    // Single window: same as before
    const transcriptText = formatSegmentsForPrompt(allSegments, speakerMap);
    consolidationContent = `Sector: ${sector?.name || "General"}
Reunión: ${meeting.title}
${(meeting.notes as string) ? `Notas: ${meeting.notes}` : ""}

TRANSCRIPCIÓN DIARIZADA:
${transcriptText}

RESULTADOS DE ESPECIALISTAS:
${windowResults[0].specialistResults.map((r) => `--- ${r.agent} ---\n${JSON.stringify(r.output, null, 2)}`).join("\n\n")}

Consolida los resultados en el JSON final según el schema de coordinador.`;
  }

  // Give coordinator more tokens for map-reduce (more data to consolidate)
  const coordMaxTokens = isMapReduce ? maxTokens * 4 : maxTokens * 3;
  const coordResult = await callLLMWithRetry(openaiKey, llmModel, temperature, coordMaxTokens, coordSystemPrompt, consolidationContent);
  totalInputTokens += coordResult.usage.input_tokens;
  totalOutputTokens += coordResult.usage.output_tokens;

  const analysisJson = coordResult.parsed;
  console.log("Coordinator result keys:", Object.keys(analysisJson));
  console.log(`Total tokens: input=${totalInputTokens}, output=${totalOutputTokens}, windows=${windows.length}`);

  // Save analysis
  const { data: latestAnalysis } = await supabase
    .from("meeting_analyses").select("version").eq("meeting_id", meetingId)
    .order("version", { ascending: false }).limit(1).single();

  const newVersion = (latestAnalysis?.version || 0) + 1;

  // Build agent_runs for observability (flatten all windows)
  const agentRuns: Array<{ agent: string; role: string; output: Record<string, unknown>; window?: number }> = [];
  for (const wr of windowResults) {
    for (const sr of wr.specialistResults) {
      // ── LOGGING DIAGNÓSTICO (nuevo) ──
      const outputKeyCount = Object.keys(sr.output || {}).length;
      console.log(`Persisting specialist "${sr.agent}" with ${outputKeyCount} output keys`);
      // ── FIN LOGGING ──
      agentRuns.push({
        agent: sr.agent,
        role: "specialist",
        output: sr.output,
        ...(isMapReduce ? { window: wr.windowIndex + 1 } : {}),
      });
    }
  }
  agentRuns.push({ agent: coordinator.name, role: "coordinator", output: analysisJson });
  // ── LOGGING DIAGNÓSTICO (nuevo) ──
  console.log(`Total agent_runs to persist: ${agentRuns.length}, JSON size: ${JSON.stringify(agentRuns).length} bytes`);
  // ── FIN LOGGING ──

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

  // Enqueue quality audit job for the Python ai-service worker (Fase 3 — Strangler Fig).
  // Uses upsert + ignoreDuplicates so re-running analysis never creates duplicate jobs.
  // Failure is non-fatal: the audit is a best-effort step; analysis response is unaffected.
  if (analysis?.id) {
    const { error: jobError } = await supabase.from("ai_jobs").upsert({
      idempotency_key: `audit_analysis:${analysis.id}`,
      job_type: "audit_analysis",
      payload: { meeting_id: meetingId, analysis_id: analysis.id },
      priority: 1,
      max_attempts: 3,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (jobError) console.error("Failed to enqueue audit job:", jobError.message);
    else console.log(`Audit job enqueued for analysis_id=${analysis.id}`);
  }

  // Log usage
  await supabase.from("usage_events").insert({
    org_id: meeting.org_id as string, meeting_id: meetingId,
    kind: "llm", provider: "openai", model: llmModel,
    units: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens, windows: windows.length },
    cost_estimate_usd: null,
    meta: { strategy: isMapReduce ? "map-reduce" : "single-pass", segment_count: allSegments.length, window_count: windows.length },
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

  // Retrieve relevant segments (vector → full-text → chronological)
  const segments = await getRelevantSegments(supabase, meetingId, openaiKey, userQuestion, 30);
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

// ── Chat Stream Mode ─────────────────────────────────────────────────────────
// Same RAG logic as handleChat but returns an SSE stream.
// Events: { type:"chunk", content:string } | { type:"done", message_id, evidence_json, created_at } | { type:"error", message }

async function handleChatStream(p: ChatParams): Promise<Response> {
  const { supabase, meetingId, meeting, user, speakerMap, openaiKey, llmModel, temperature, maxTokens, userQuestion, corsHeaders } = p;

  if (!userQuestion) {
    return new Response(JSON.stringify({ error: "Falta user_question para modo chat" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Save user message before streaming starts
  await supabase.from("chat_messages").insert({
    meeting_id: meetingId, user_id: user.id, role: "user", content: userQuestion,
  });

  // RAG: same retrieval as handleChat
  const segments = await getRelevantSegments(supabase, meetingId, openaiKey, userQuestion, 30);
  const transcriptText = formatSegmentsForPrompt(segments, speakerMap);

  const { data: latestAnalysis } = await supabase
    .from("meeting_analyses").select("analysis_json").eq("meeting_id", meetingId)
    .order("version", { ascending: false }).limit(1).single();

  let analysisSummary = "";
  if (latestAnalysis?.analysis_json) {
    const aj = latestAnalysis.analysis_json as Record<string, unknown>;
    if (aj.summary) analysisSummary = `\nRESUMEN DEL ANÁLISIS PREVIO:\n${aj.summary}\n`;
  }

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

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const usesNewParam = /^(gpt-4o|gpt-5|o[1-9])/.test(llmModel);
  const openaiBody: Record<string, unknown> = {
    model: llmModel, messages, temperature, stream: true,
    ...(usesNewParam ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
  };

  const evidenceJson = segments.slice(0, 5).map((s) => ({
    speaker: speakerMap[s.speaker_label] || s.speaker_name || s.speaker_label,
    t_start_sec: s.t_start_sec, t_end_sec: s.t_end_sec, quote: s.text.substring(0, 150),
  }));

  const encoder = new TextEncoder();
  const streamBody = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify(openaiBody),
        });

        if (!openaiRes.ok) {
          const errText = await openaiRes.text();
          console.error("OpenAI stream error:", openaiRes.status, errText);
          send({ type: "error", message: `Error LLM: ${openaiRes.status}` });
          controller.close();
          return;
        }

        const reader = openaiRes.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let fullContent = "";
        let inputTokens = 0;
        let outputTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const raw = trimmed.slice(6);
            if (raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) { fullContent += delta; send({ type: "chunk", content: delta }); }
              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens ?? 0;
                outputTokens = parsed.usage.completion_tokens ?? 0;
              }
            } catch { /* skip malformed chunk */ }
          }
        }

        // Persist assistant message after stream completes
        const { data: assistantMsg } = await supabase
          .from("chat_messages")
          .insert({ meeting_id: meetingId, user_id: user.id, role: "assistant", content: fullContent, evidence_json: evidenceJson })
          .select("id, content, evidence_json, created_at").single();

        // Log usage (non-fatal)
        supabase.from("usage_events").insert({
          org_id: meeting.org_id as string, meeting_id: meetingId,
          kind: "llm", provider: "openai", model: llmModel,
          units: { input_tokens: inputTokens, output_tokens: outputTokens },
          cost_estimate_usd: null,
        }).catch((e: unknown) => console.warn("Usage log failed:", e));

        send({ type: "done", message_id: assistantMsg?.id, evidence_json: assistantMsg?.evidence_json, created_at: assistantMsg?.created_at });

      } catch (err) {
        console.error("Chat stream error:", err);
        send({ type: "error", message: err instanceof Error ? err.message : "Error interno" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(streamBody, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
}