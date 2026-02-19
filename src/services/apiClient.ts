import { supabase } from "@/integrations/supabase/client";

// ── Upload ──────────────────────────────────────────────────────────────
export async function getSignedUploadUrl(meetingId: string, filename: string, mimeType: string) {
  const { data, error } = await supabase.functions.invoke("create-signed-upload-url", {
    body: { meeting_id: meetingId, filename, mime_type: mimeType },
  });
  if (error) throw error;
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
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
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
  const { data, error } = await supabase.functions.invoke("stt-transcribe", {
    body: { meeting_id: meetingId },
  });
  if (error) throw error;
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
  const { data, error } = await supabase.functions.invoke("agent-orchestrator", {
    body: { meeting_id: meetingId, mode: "analyze" },
  });
  if (error) throw error;
  return data as { analysis_id: string; version: number; analysis: Record<string, unknown> };
}

// ── Chat ────────────────────────────────────────────────────────────────
export async function chatWithMeeting(meetingId: string, question: string) {
  const { data, error } = await supabase.functions.invoke("agent-orchestrator", {
    body: { meeting_id: meetingId, mode: "chat", user_question: question },
  });
  if (error) throw error;
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
  // get-meeting-bundle uses query params, so we call via fetch
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
    throw new Error((err as Record<string, string>).error || `Error ${res.status}`);
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
  if (!user) throw new Error("No autorizado");

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
