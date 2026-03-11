import { supabase } from "@/integrations/supabase/client";

// ── Error Handling ──────────────────────────────────────────────────────
function friendlyError(status: number, body: Record<string, string>): string {
  const code = body.error;
  if (status === 401) return "Sesión expirada. Inicia sesión nuevamente.";
  if (status === 403) return "No tienes permiso para esta acción.";
  if (status === 412 && code === "missing_openai_key")
    return "Falta la clave de OpenAI. Configúrala en Supabase > Edge Function Secrets.";
  if (status === 429)
    return body.message || "Demasiadas solicitudes. Espera un momento e intenta de nuevo.";
  return body.error || body.message || `Error ${status}`;
}

async function invokeFunction(name: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let parsed: Record<string, string> = {};
    let status = 500;
    try {
      // Prefer context.status (reliable) over regex on message
      const ctx = (error as any).context;
      if (ctx?.status) {
        status = ctx.status;
      } else if (error.message) {
        const match = error.message.match(/(\d{3})/);
        if (match) status = parseInt(match[1]);
      }
      if (ctx?.json) {
        parsed = await ctx.json();
      }
    } catch { /* ignore parse errors */ }
    throw new Error(friendlyError(status, parsed));
  }
  return data;
}

// ── Upload ──────────────────────────────────────────────────────────────
export async function getSignedUploadUrl(meetingId: string, filename: string, mimeType: string) {
  const data = await invokeFunction("create-signed-upload-url", {
    meeting_id: meetingId, filename, mime_type: mimeType,
  });
  return data as { signed_url: string; storage_path: string; token: string };
}

export async function uploadAudioToStorage(
  signedUrl: string,
  token: string,
  file: Blob,
  mimeType: string
) {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType, Authorization: `Bearer ${token}` },
    body: file,
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error("Error de permisos al subir audio. Verifica las políticas de storage.");
    throw new Error(`Error al subir audio: ${res.status}`);
  }
}

export async function saveMeetingAudio(
  meetingId: string,
  storagePath: string,
  mimeType: string,
  durationSec?: number
) {
  const { error } = await supabase.from("meeting_audio").insert({
    meeting_id: meetingId,
    storage_path: storagePath,
    mime_type: mimeType,
    duration_sec: durationSec ?? null,
  });
  if (error) throw error;
}

// ── Transcription ───────────────────────────────────────────────────────
export async function transcribeMeeting(meetingId: string) {
  const data = await invokeFunction("stt-transcribe", { meeting_id: meetingId });
  return data as {
    transcript_id: string;
    version: number;
    segments_count: number;
    duration: number;
    speaker_map: Record<string, string>;
  };
}

// ── Analysis ────────────────────────────────────────────────────────────
export async function analyzeMeeting(meetingId: string) {
  const data = await invokeFunction("agent-orchestrator", {
    meeting_id: meetingId, mode: "analyze",
  });
  return data as { analysis_id: string; version: number; analysis: Record<string, unknown> };
}

// ── Chat ────────────────────────────────────────────────────────────────
export async function chatWithMeeting(meetingId: string, question: string) {
  const data = await invokeFunction("agent-orchestrator", {
    meeting_id: meetingId, mode: "chat", user_question: question,
  });
  return data as {
    message: {
      id: string;
      content: string;
      evidence_json: Array<{
        speaker: string;
        t_start_sec: number;
        t_end_sec: number;
        quote: string;
      }>;
      created_at: string;
    };
  };
}

// ── Bundle ──────────────────────────────────────────────────────────────
export async function getMeetingBundle(meetingId: string, segmentPage = 0, segmentLimit = 100) {
  const session = (await supabase.auth.getSession()).data.session;
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/get-meeting-bundle?meeting_id=${meetingId}&segment_page=${segmentPage}&segment_limit=${segmentLimit}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(friendlyError(res.status, err as Record<string, string>));
  }

  return res.json();
}

// ── Speakers ────────────────────────────────────────────────────────────
export async function renameSpeaker(meetingId: string, speakerLabel: string, speakerName: string) {
  const { error } = await supabase.from("meeting_speakers").upsert(
    { meeting_id: meetingId, speaker_label: speakerLabel, speaker_name: speakerName },
    { onConflict: "meeting_id,speaker_label" }
  );
  if (error) throw error;
}

// ── Meetings CRUD ───────────────────────────────────────────────────────
export async function createMeeting(orgId: string, sectorId: string, title: string, notes?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sesión expirada. Inicia sesión nuevamente.");

  const { data, error } = await supabase
    .from("meetings")
    .insert({
      org_id: orgId,
      sector_id: sectorId,
      title,
      notes: notes || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

export async function listMeetings(orgId: string) {
  const { data, error } = await supabase
    .from("meetings")
    .select("*, sectors(key, name)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

// ── Chat Streaming ───────────────────────────────────────────────────────
// Returns the raw fetch Response — caller must process the SSE stream.
// Uses fetch directly (supabase.functions.invoke doesn't support streaming).
export async function streamChatWithMeeting(meetingId: string, userQuestion: string): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sesión expirada. Inicia sesión nuevamente.");

  const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/agent-orchestrator`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ meeting_id: meetingId, mode: "chat", user_question: userQuestion, stream: true }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `Error ${response.status}` }));
    throw new Error(err.error || `Error ${response.status}`);
  }
  return response;
}

// ── Org Members ─────────────────────────────────────────────────────────
export interface OrgMember {
  id: string;
  user_id: string;
  email: string;
  role: string;
  created_at: string;
  is_self: boolean;
}

export async function getOrgMembers(): Promise<{ members: OrgMember[]; caller_role: string }> {
  const data = await invokeFunction("get-org-members", {});
  return data as { members: OrgMember[]; caller_role: string };
}

// ── Demo ────────────────────────────────────────────────────────────────
export async function createDemoMeeting(orgId: string, sectorKey: string) {
  const data = await invokeFunction("create-demo-meeting", {
    org_id: orgId, sector_key: sectorKey,
  });
  return data as { meeting_id: string; reused: boolean; status: string };
}
