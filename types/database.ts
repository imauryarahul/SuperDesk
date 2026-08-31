// Generated from the Supabase schema. Regenerate with:
//   supabase gen types typescript --project-id <ref> > types/database.ts
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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      contacts: {
        Row: {
          anonymous_token: string | null
          created_at: string
          email: string | null
          id: string
          last_seen_at: string
          name: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          anonymous_token?: string | null
          created_at?: string
          email?: string | null
          id?: string
          last_seen_at?: string
          name?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          anonymous_token?: string | null
          created_at?: string
          email?: string | null
          id?: string
          last_seen_at?: string
          name?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_summary: string | null
          ai_summary_message_count: number
          ai_summary_updated_at: string | null
          assigned_agent_id: string | null
          channel: Database["public"]["Enums"]["conversation_channel"]
          contact_id: string
          created_at: string
          id: string
          last_message_at: string
          resolved_at: string | null
          snoozed_at: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          subject: string | null
          total_snoozed_seconds: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_summary?: string | null
          ai_summary_message_count?: number
          ai_summary_updated_at?: string | null
          assigned_agent_id?: string | null
          channel: Database["public"]["Enums"]["conversation_channel"]
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string
          resolved_at?: string | null
          snoozed_at?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          subject?: string | null
          total_snoozed_seconds?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_summary?: string | null
          ai_summary_message_count?: number
          ai_summary_updated_at?: string | null
          assigned_agent_id?: string | null
          channel?: Database["public"]["Enums"]["conversation_channel"]
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
          resolved_at?: string | null
          snoozed_at?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          subject?: string | null
          total_snoozed_seconds?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_agent_id_workspace_id_fkey"
            columns: ["assigned_agent_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "conversations_contact_id_workspace_id_fkey"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_articles: {
        Row: {
          body: string
          category_id: string | null
          created_at: string
          id: string
          published: boolean
          search_vector: unknown
          slug: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body?: string
          category_id?: string | null
          created_at?: string
          id?: string
          published?: boolean
          search_vector?: unknown
          slug?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: string
          category_id?: string | null
          created_at?: string
          id?: string
          published?: boolean
          search_vector?: unknown
          slug?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_articles_category_id_workspace_id_fkey"
            columns: ["category_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "kb_categories"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "kb_articles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          email_in_reply_to: string | null
          email_message_id: string | null
          id: string
          sender_id: string | null
          sender_type: Database["public"]["Enums"]["message_sender_type"]
          workspace_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          email_in_reply_to?: string | null
          email_message_id?: string | null
          id?: string
          sender_id?: string | null
          sender_type: Database["public"]["Enums"]["message_sender_type"]
          workspace_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          email_in_reply_to?: string | null
          email_message_id?: string | null
          id?: string
          sender_id?: string | null
          sender_type?: Database["public"]["Enums"]["message_sender_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_workspace_id_fkey"
            columns: ["conversation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string
          created_at: string
          email: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["user_role"]
          token: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["user_role"]
          token: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          token?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          allowed_widget_domains: string[]
          /** ISO day-of-week, 1 = Monday … 7 = Sunday. */
          business_days: number[]
          /** Postgres `time`, serialized as 'HH:MM:SS'. */
          business_hours_end: string
          /** Postgres `time`, serialized as 'HH:MM:SS'. */
          business_hours_start: string
          /** IANA timezone name; validated by a trigger against pg_timezone_names. */
          business_timezone: string
          created_at: string
          custom_domain: string | null
          custom_domain_status: Database["public"]["Enums"]["custom_domain_status"]
          custom_domain_verified_at: string | null
          first_response_target_minutes: number
          id: string
          inbound_token: string
          name: string
          resolution_target_minutes: number
          slug: string
          updated_at: string
        }
        Insert: {
          allowed_widget_domains?: string[]
          business_days?: number[]
          business_hours_end?: string
          business_hours_start?: string
          business_timezone?: string
          created_at?: string
          custom_domain?: string | null
          custom_domain_status?: Database["public"]["Enums"]["custom_domain_status"]
          custom_domain_verified_at?: string | null
          first_response_target_minutes?: number
          id?: string
          inbound_token?: string
          name: string
          resolution_target_minutes?: number
          slug?: string
          updated_at?: string
        }
        Update: {
          allowed_widget_domains?: string[]
          business_days?: number[]
          business_hours_end?: string
          business_hours_start?: string
          business_timezone?: string
          created_at?: string
          custom_domain?: string | null
          custom_domain_status?: Database["public"]["Enums"]["custom_domain_status"]
          custom_domain_verified_at?: string | null
          first_response_target_minutes?: number
          id?: string
          inbound_token?: string
          name?: string
          resolution_target_minutes?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_analytics_agent_stats: {
        Args: Record<PropertyKey, never>
        Returns: {
          agent_id: string
          full_name: string | null
          agent_email: string
          conversations_resolved: number
          /** Postgres `numeric` arrives over the wire as a string; coerce before use. */
          avg_first_response_secs: string | null
        }[]
      }
      get_analytics_busiest_hours: {
        Args: Record<PropertyKey, never>
        Returns: {
          hour: number
          message_count: number
        }[]
      }
      get_analytics_first_response: {
        Args: Record<PropertyKey, never>
        /** The three `numeric` columns arrive over the wire as strings; coerce before use. */
        Returns: {
          avg_seconds: string | null
          median_seconds: string | null
          p95_seconds: string | null
          measured_count: number
        }[]
      }
      get_analytics_resolution_rate: {
        Args: Record<PropertyKey, never>
        Returns: {
          resolved_count: number
          total_count: number
        }[]
      }
      /**
       * SLA per conversation, computed on read. Pass null for
       * p_conversation_ids to cover every conversation the caller can see.
       * The two state columns are `text` in Postgres; narrow them with
       * `isSlaState` in lib/sla.ts rather than casting.
       */
      get_conversations_sla: {
        Args: {
          p_conversation_ids: string[] | null
          p_unresolved_only: boolean
        }
        Returns: {
          conversation_id: string
          first_response_state: string | null
          first_response_seconds: number | null
          first_response_target_seconds: number
          first_response_at: string | null
          resolution_state: string | null
          resolution_seconds: number | null
          resolution_target_seconds: number
        }[]
      }
      get_sla_breach_summary: {
        Args: Record<PropertyKey, never>
        Returns: {
          breached_count: number
          first_response_breached: number
          resolution_breached: number
          unresolved_count: number
        }[]
      }
      accept_workspace_invite: {
        Args: {
          p_auth_user_id: string
          p_email: string
          p_full_name?: string
          p_token: string
        }
        Returns: string
      }
      create_workspace_with_admin: {
        Args: {
          p_auth_user_id: string
          p_email: string
          p_full_name?: string
          p_workspace_name: string
        }
        Returns: string
      }
      increment_rate_limit: {
        Args: {
          p_ip: string
          p_scope: string
          p_window_sec: number
          p_max: number
        }
        Returns: boolean
      }
      search_kb_articles: {
        Args: {
          p_limit?: number
          p_query: string
          p_workspace_id: string
        }
        Returns: {
          id: string
          slug: string
          title: string
          body: string
          category_id: string | null
        }[]
      }
    }
    Enums: {
      conversation_channel: "chat" | "email"
      conversation_status: "open" | "snoozed" | "resolved"
      custom_domain_status: "none" | "pending" | "verified" | "error"
      message_sender_type: "contact" | "agent" | "system"
      user_role: "admin" | "agent"
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
    Enums: {
      conversation_channel: ["chat", "email"],
      conversation_status: ["open", "snoozed", "resolved"],
      custom_domain_status: ["none", "pending", "verified", "error"],
      message_sender_type: ["contact", "agent", "system"],
      user_role: ["admin", "agent"],
    },
  },
} as const
