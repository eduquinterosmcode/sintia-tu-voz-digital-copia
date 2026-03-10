import { useQuery } from "@tanstack/react-query";
import { getMeetingBundle } from "@/services/apiClient";
import type { SectorViewConfig } from "@/features/analysis/viewConfig.types";

export interface Evidence {
  speaker: string;
  t_start_sec: number;
  t_end_sec: number;
  quote: string;
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
    sectors: { key: string; name: string; view_config_json: SectorViewConfig | null } | null;
  };
  speakers: Speaker[];
  transcript: {
    id: string;
    version: number;
    transcript_text: string | null;
    created_at: string;
  } | null;
  segments: Segment[];
  segment_page: number;
  analysis: {
    id: string;
    version: number;
    analysis_json: Record<string, unknown>;
    agent_runs: Array<{ agent: string; role: string; output: Record<string, unknown> }> | null;
    created_at: string;
  } | null;
  chat_messages: ChatMessage[];
  audio: {
    id: string;
    storage_path: string;
    mime_type: string | null;
    duration_sec: number | null;
  } | null;
  quality_report: {
    id: string;
    analysis_id: string;
    confidence_score: number;
    report_json: {
      confidence_score: number;
      contradictions: Array<{
        claim_a: string;
        claim_b: string;
        severity: "high" | "medium" | "low";
        sources: string[];
        explanation: string;
      }>;
      unsupported_claims: Array<{
        claim: string;
        section: string;
        severity: "high" | "medium" | "low";
        reason: string;
      }>;
      summary: string;
    };
    created_at: string;
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
