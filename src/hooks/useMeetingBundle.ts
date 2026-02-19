import { useQuery } from "@tanstack/react-query";
import { getMeetingBundle } from "@/services/apiClient";

export interface Evidence {
  speaker: string;
  t_start_sec: number;
  t_end_sec: number;
  quote: string;
}

export interface KeyPoint {
  point: string;
  evidence: Evidence[];
}

export interface Decision {
  decision: string;
  owner: string | null;
  evidence: Evidence[];
}

export interface ActionItem {
  task: string;
  owner: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high";
  evidence: Evidence[];
}

export interface RiskAlert {
  risk: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
  evidence: Evidence[];
}

export interface SuggestedResponse {
  context: string;
  message: string;
  evidence: Evidence[];
}

export interface AnalysisJson {
  sector: string;
  meeting_title: string;
  summary: string;
  key_points: KeyPoint[];
  decisions: Decision[];
  action_items: ActionItem[];
  risks_alerts: RiskAlert[];
  open_questions: string[];
  suggested_responses: SuggestedResponse[];
  confidence_notes: string[];
}

export interface Segment {
  id: string;
  segment_index: number;
  speaker_label: string;
  speaker_name: string | null;
  t_start_sec: number;
  t_end_sec: number;
  text: string;
}

export interface Speaker {
  id: string;
  meeting_id: string;
  speaker_label: string;
  speaker_name: string;
}

export interface ChatMessage {
  id: string;
  meeting_id: string;
  user_id: string | null;
  role: string;
  content: string;
  evidence_json: Evidence[] | null;
  created_at: string;
}

export interface MeetingBundle {
  meeting: {
    id: string;
    org_id: string;
    title: string;
    status: string;
    language: string;
    notes: string | null;
    created_at: string;
    sector_id: string;
    sectors: { key: string; name: string } | null;
  };
  speakers: Speaker[];
  transcript: {
    id: string;
    version: number;
    transcript_text: string | null;
  } | null;
  segments: Segment[];
  segment_page: number;
  analysis: {
    id: string;
    version: number;
    analysis_json: AnalysisJson;
  } | null;
  chat_messages: ChatMessage[];
  audio: {
    id: string;
    mime_type: string | null;
    duration_sec: number | null;
  } | null;
}

export function useMeetingBundle(meetingId: string | undefined) {
  return useQuery<MeetingBundle>({
    queryKey: ["meeting-bundle", meetingId],
    queryFn: () => getMeetingBundle(meetingId!),
    enabled: !!meetingId,
    refetchOnWindowFocus: false,
  });
}
