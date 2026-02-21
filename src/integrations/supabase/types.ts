export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      agent_profiles: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          order_index: number
          output_schema_json: Json | null
          role: string
          sector_id: string
          system_prompt: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          order_index?: number
          output_schema_json?: Json | null
          role: string
          sector_id: string
          system_prompt: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          order_index?: number
          output_schema_json?: Json | null
          role?: string
          sector_id?: string
          system_prompt?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_profiles_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          evidence_json: Json | null
          id: string
          meeting_id: string
          role: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          evidence_json?: Json | null
          id?: string
          meeting_id: string
          role: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          evidence_json?: Json | null
          id?: string
          meeting_id?: string
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_analyses: {
        Row: {
          agent_runs: Json | null
          analysis_json: Json | null
          created_at: string
          created_by: string | null
          id: string
          meeting_id: string
          sector_id: string | null
          version: number
        }
        Insert: {
          agent_runs?: Json | null
          analysis_json?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          meeting_id: string
          sector_id?: string | null
          version?: number
        }
        Update: {
          agent_runs?: Json | null
          analysis_json?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          meeting_id?: string
          sector_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "meeting_analyses_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_analyses_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_audio: {
        Row: {
          created_at: string
          duration_sec: number | null
          id: string
          meeting_id: string
          mime_type: string | null
          storage_path: string
        }
        Insert: {
          created_at?: string
          duration_sec?: number | null
          id?: string
          meeting_id: string
          mime_type?: string | null
          storage_path: string
        }
        Update: {
          created_at?: string
          duration_sec?: number | null
          id?: string
          meeting_id?: string
          mime_type?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_audio_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_segments: {
        Row: {
          created_at: string
          id: string
          meeting_id: string
          segment_index: number
          speaker_label: string
          speaker_name: string | null
          t_end_sec: number
          t_start_sec: number
          text: string
          text_search: unknown
          transcript_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meeting_id: string
          segment_index: number
          speaker_label: string
          speaker_name?: string | null
          t_end_sec: number
          t_start_sec: number
          text: string
          text_search?: unknown
          transcript_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meeting_id?: string
          segment_index?: number
          speaker_label?: string
          speaker_name?: string | null
          t_end_sec?: number
          t_start_sec?: number
          text?: string
          text_search?: unknown
          transcript_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_segments_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_segments_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "meeting_transcripts"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_speakers: {
        Row: {
          id: string
          meeting_id: string
          speaker_label: string
          speaker_name: string
          updated_at: string
        }
        Insert: {
          id?: string
          meeting_id: string
          speaker_label: string
          speaker_name: string
          updated_at?: string
        }
        Update: {
          id?: string
          meeting_id?: string
          speaker_label?: string
          speaker_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_speakers_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_transcripts: {
        Row: {
          created_at: string
          created_by: string | null
          diarization_json: Json | null
          id: string
          meeting_id: string
          provider: string | null
          stt_model: string | null
          transcript_text: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          diarization_json?: Json | null
          id?: string
          meeting_id: string
          provider?: string | null
          stt_model?: string | null
          transcript_text?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          diarization_json?: Json | null
          id?: string
          meeting_id?: string
          provider?: string | null
          stt_model?: string | null
          transcript_text?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "meeting_transcripts_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          created_at: string
          created_by: string
          id: string
          language: string
          notes: string | null
          org_id: string
          sector_id: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          language?: string
          notes?: string | null
          org_id: string
          sector_id: string
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          language?: string
          notes?: string | null
          org_id?: string
          sector_id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_provider_settings: {
        Row: {
          budget_hard_usd: number
          budget_soft_usd: number
          llm_model: string
          max_output_tokens: number
          org_id: string
          provider: string
          stt_model: string
          temperature: number
          updated_at: string
        }
        Insert: {
          budget_hard_usd?: number
          budget_soft_usd?: number
          llm_model?: string
          max_output_tokens?: number
          org_id: string
          provider?: string
          stt_model?: string
          temperature?: number
          updated_at?: string
        }
        Update: {
          budget_hard_usd?: number
          budget_soft_usd?: number
          llm_model?: string
          max_output_tokens?: number
          org_id?: string
          provider?: string
          stt_model?: string
          temperature?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_provider_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      sectors: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          name?: string
        }
        Relationships: []
      }
      usage_events: {
        Row: {
          cost_estimate_usd: number | null
          created_at: string
          id: string
          kind: string
          meeting_id: string | null
          meta: Json | null
          model: string | null
          org_id: string
          provider: string | null
          units: Json | null
        }
        Insert: {
          cost_estimate_usd?: number | null
          created_at?: string
          id?: string
          kind: string
          meeting_id?: string | null
          meta?: Json | null
          model?: string | null
          org_id: string
          provider?: string | null
          units?: Json | null
        }
        Update: {
          cost_estimate_usd?: number | null
          created_at?: string
          id?: string
          kind?: string
          meeting_id?: string | null
          meta?: Json | null
          model?: string | null
          org_id?: string
          provider?: string | null
          units?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      agent_profiles_public: {
        Row: {
          created_at: string | null
          enabled: boolean | null
          id: string | null
          name: string | null
          order_index: number | null
          role: string | null
          sector_id: string | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean | null
          id?: string | null
          name?: string | null
          order_index?: number | null
          role?: string | null
          sector_id?: string | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean | null
          id?: string | null
          name?: string | null
          order_index?: number | null
          role?: string | null
          sector_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_profiles_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      meeting_org_id: { Args: { _meeting_id: string }; Returns: string }
      user_has_org_access: { Args: { _org_id: string }; Returns: boolean }
      user_is_org_owner: { Args: { _org_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
