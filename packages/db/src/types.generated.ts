export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      aeo_snapshots: {
        Row: {
          ai_bots: Json | null
          checks: Json | null
          error: string | null
          has_llms_txt: boolean | null
          measured_at: string | null
          org_id: string
          schema_types: string[] | null
          score: number | null
          site_id: string
        }
        Insert: {
          ai_bots?: Json | null
          checks?: Json | null
          error?: string | null
          has_llms_txt?: boolean | null
          measured_at?: string | null
          org_id: string
          schema_types?: string[] | null
          score?: number | null
          site_id: string
        }
        Update: {
          ai_bots?: Json | null
          checks?: Json | null
          error?: string | null
          has_llms_txt?: boolean | null
          measured_at?: string | null
          org_id?: string
          schema_types?: string[] | null
          score?: number | null
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aeo_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aeo_snapshots_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string
          id: string
          org_id: string
          resolved_at: string | null
          sent_at: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          site_id: string | null
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key: string
          id?: string
          org_id: string
          resolved_at?: string | null
          sent_at?: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          site_id?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string
          id?: string
          org_id?: string
          resolved_at?: string | null
          sent_at?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          site_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      change_log: {
        Row: {
          created_at: string
          id: number
          kind: string
          message: string
          org_id: string
          severity: string
          site_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          kind: string
          message: string
          org_id: string
          severity?: string
          site_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          kind?: string
          message?: string
          org_id?: string
          severity?: string
          site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "change_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_log_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          monthly_report: boolean
          org_id: string
          recipients: string[]
          updated_at: string
          weekly_digest: boolean
        }
        Insert: {
          monthly_report?: boolean
          org_id: string
          recipients?: string[]
          updated_at?: string
          weekly_digest?: boolean
        }
        Update: {
          monthly_report?: boolean
          org_id?: string
          recipients?: string[]
          updated_at?: string
          weekly_digest?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          company: string | null
          contract_type: string | null
          created_at: string
          dic: string | null
          email: string | null
          hourly_rate_eur: number | null
          ico: string | null
          id: string
          monthly_fee_eur: number | null
          name: string
          notes: string | null
          notion_page_id: string | null
          org_id: string
          phone: string | null
          report_email: string | null
          slug: string | null
          status: string
          status_enabled: boolean
        }
        Insert: {
          company?: string | null
          contract_type?: string | null
          created_at?: string
          dic?: string | null
          email?: string | null
          hourly_rate_eur?: number | null
          ico?: string | null
          id?: string
          monthly_fee_eur?: number | null
          name: string
          notes?: string | null
          notion_page_id?: string | null
          org_id: string
          phone?: string | null
          report_email?: string | null
          slug?: string | null
          status?: string
          status_enabled?: boolean
        }
        Update: {
          company?: string | null
          contract_type?: string | null
          created_at?: string
          dic?: string | null
          email?: string | null
          hourly_rate_eur?: number | null
          ico?: string | null
          id?: string
          monthly_fee_eur?: number | null
          name?: string
          notes?: string | null
          notion_page_id?: string | null
          org_id?: string
          phone?: string | null
          report_email?: string | null
          slug?: string | null
          status?: string
          status_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          checked_at: string | null
          domain: string
          error: string | null
          expires_at: string | null
          nameservers: string[] | null
          org_id: string
          registrar: string | null
          site_id: string
          source: string | null
        }
        Insert: {
          checked_at?: string | null
          domain: string
          error?: string | null
          expires_at?: string | null
          nameservers?: string[] | null
          org_id: string
          registrar?: string | null
          site_id: string
          source?: string | null
        }
        Update: {
          checked_at?: string | null
          domain?: string
          error?: string | null
          expires_at?: string | null
          nameservers?: string[] | null
          org_id?: string
          registrar?: string | null
          site_id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "domains_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domains_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_snapshots: {
        Row: {
          clicks: number | null
          ctr: number | null
          error: string | null
          impressions: number | null
          measured_at: string | null
          org_id: string
          position: number | null
          property: string | null
          range_days: number | null
          site_id: string
          top_queries: Json | null
        }
        Insert: {
          clicks?: number | null
          ctr?: number | null
          error?: string | null
          impressions?: number | null
          measured_at?: string | null
          org_id: string
          position?: number | null
          property?: string | null
          range_days?: number | null
          site_id: string
          top_queries?: Json | null
        }
        Update: {
          clicks?: number | null
          ctr?: number | null
          error?: string | null
          impressions?: number | null
          measured_at?: string | null
          org_id?: string
          position?: number | null
          property?: string | null
          range_days?: number | null
          site_id?: string
          top_queries?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "gsc_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_snapshots_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          cause: string | null
          duration_seconds: number | null
          id: string
          last_status_code: number | null
          org_id: string
          resolved_at: string | null
          site_id: string
          started_at: string
        }
        Insert: {
          cause?: string | null
          duration_seconds?: number | null
          id?: string
          last_status_code?: number | null
          org_id: string
          resolved_at?: string | null
          site_id: string
          started_at?: string
        }
        Update: {
          cause?: string | null
          duration_seconds?: number | null
          id?: string
          last_status_code?: number | null
          org_id?: string
          resolved_at?: string | null
          site_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      infra_snapshots: {
        Row: {
          cdn: string | null
          error: string | null
          hosting: string | null
          https_redirect: boolean | null
          ip: string | null
          measured_at: string | null
          org_id: string
          powered_by: string | null
          security_txt: boolean | null
          server: string | null
          site_id: string
          tls_version: string | null
        }
        Insert: {
          cdn?: string | null
          error?: string | null
          hosting?: string | null
          https_redirect?: boolean | null
          ip?: string | null
          measured_at?: string | null
          org_id: string
          powered_by?: string | null
          security_txt?: boolean | null
          server?: string | null
          site_id: string
          tls_version?: string | null
        }
        Update: {
          cdn?: string | null
          error?: string | null
          hosting?: string | null
          https_redirect?: boolean | null
          ip?: string | null
          measured_at?: string | null
          org_id?: string
          powered_by?: string | null
          security_txt?: boolean | null
          server?: string | null
          site_id?: string
          tls_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "infra_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infra_snapshots_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          error: string | null
          failed: number | null
          finished_at: string
          id: number
          job: string
          ok: number | null
          status: string
        }
        Insert: {
          error?: string | null
          failed?: number | null
          finished_at?: string
          id?: never
          job: string
          ok?: number | null
          status: string
        }
        Update: {
          error?: string | null
          failed?: number | null
          finished_at?: string
          id?: never
          job?: string
          ok?: number | null
          status?: string
        }
        Relationships: []
      }
      memberships: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_history: {
        Row: {
          captured_at: string
          id: number
          metric: string
          org_id: string
          site_id: string
          value: number | null
        }
        Insert: {
          captured_at?: string
          id?: never
          metric: string
          org_id: string
          site_id: string
          value?: number | null
        }
        Update: {
          captured_at?: string
          id?: never
          metric?: string
          org_id?: string
          site_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_history_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
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
      perf_snapshots: {
        Row: {
          accessibility: number | null
          best_practices: number | null
          cls: number | null
          error: string | null
          field_cls: number | null
          field_inp_ms: number | null
          field_lcp_ms: number | null
          inp_ms: number | null
          lcp_ms: number | null
          measured_at: string | null
          org_id: string
          page_weight_kb: number | null
          performance_score: number | null
          requests: number | null
          seo: number | null
          site_id: string
          strategy: string
          tbt_ms: number | null
          ttfb_ms: number | null
        }
        Insert: {
          accessibility?: number | null
          best_practices?: number | null
          cls?: number | null
          error?: string | null
          field_cls?: number | null
          field_inp_ms?: number | null
          field_lcp_ms?: number | null
          inp_ms?: number | null
          lcp_ms?: number | null
          measured_at?: string | null
          org_id: string
          page_weight_kb?: number | null
          performance_score?: number | null
          requests?: number | null
          seo?: number | null
          site_id: string
          strategy: string
          tbt_ms?: number | null
          ttfb_ms?: number | null
        }
        Update: {
          accessibility?: number | null
          best_practices?: number | null
          cls?: number | null
          error?: string | null
          field_cls?: number | null
          field_inp_ms?: number | null
          field_lcp_ms?: number | null
          inp_ms?: number | null
          lcp_ms?: number | null
          measured_at?: string | null
          org_id?: string
          page_weight_kb?: number | null
          performance_score?: number | null
          requests?: number | null
          seo?: number | null
          site_id?: string
          strategy?: string
          tbt_ms?: number | null
          ttfb_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "perf_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "perf_snapshots_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      security_snapshots: {
        Row: {
          error: string | null
          headers: Json | null
          measured_at: string | null
          org_id: string
          safe_browsing_ok: boolean | null
          score: number | null
          site_id: string
        }
        Insert: {
          error?: string | null
          headers?: Json | null
          measured_at?: string | null
          org_id: string
          safe_browsing_ok?: boolean | null
          score?: number | null
          site_id: string
        }
        Update: {
          error?: string | null
          headers?: Json | null
          measured_at?: string | null
          org_id?: string
          safe_browsing_ok?: boolean | null
          score?: number | null
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_snapshots_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_snapshots: {
        Row: {
          canonical_ok: boolean | null
          error: string | null
          issues: Json | null
          measured_at: string | null
          org_id: string
          pages_crawled: number | null
          robots_ok: boolean | null
          site_id: string
          sitemap_ok: boolean | null
        }
        Insert: {
          canonical_ok?: boolean | null
          error?: string | null
          issues?: Json | null
          measured_at?: string | null
          org_id: string
          pages_crawled?: number | null
          robots_ok?: boolean | null
          site_id: string
          sitemap_ok?: boolean | null
        }
        Update: {
          canonical_ok?: boolean | null
          error?: string | null
          issues?: Json | null
          measured_at?: string | null
          org_id?: string
          pages_crawled?: number | null
          robots_ok?: boolean | null
          site_id?: string
          sitemap_ok?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "seo_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seo_snapshots_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          bitwarden_item_url: string | null
          client_id: string | null
          cms: Database["public"]["Enums"]["site_cms"]
          consecutive_failures: number
          created_at: string
          domain: string
          expected_string: string | null
          hosting_provider: string | null
          id: string
          is_active: boolean
          is_free: boolean
          last_checked_at: string | null
          maintenance: boolean
          name: string
          notes: string | null
          org_id: string
          registrar: string | null
          tags: string[]
          url: string
        }
        Insert: {
          bitwarden_item_url?: string | null
          client_id?: string | null
          cms?: Database["public"]["Enums"]["site_cms"]
          consecutive_failures?: number
          created_at?: string
          domain: string
          expected_string?: string | null
          hosting_provider?: string | null
          id?: string
          is_active?: boolean
          is_free?: boolean
          last_checked_at?: string | null
          maintenance?: boolean
          name: string
          notes?: string | null
          org_id: string
          registrar?: string | null
          tags?: string[]
          url: string
        }
        Update: {
          bitwarden_item_url?: string | null
          client_id?: string | null
          cms?: Database["public"]["Enums"]["site_cms"]
          consecutive_failures?: number
          created_at?: string
          domain?: string
          expected_string?: string | null
          hosting_provider?: string | null
          id?: string
          is_active?: boolean
          is_free?: boolean
          last_checked_at?: string | null
          maintenance?: boolean
          name?: string
          notes?: string | null
          org_id?: string
          registrar?: string | null
          tags?: string[]
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tls_certs: {
        Row: {
          checked_at: string | null
          error: string | null
          issuer: string | null
          org_id: string
          site_id: string
          source: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          checked_at?: string | null
          error?: string | null
          issuer?: string | null
          org_id: string
          site_id: string
          source?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          checked_at?: string | null
          error?: string | null
          issuer?: string | null
          org_id?: string
          site_id?: string
          source?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tls_certs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tls_certs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      uptime_checks: {
        Row: {
          checked_at: string
          error: string | null
          id: number
          ok: boolean
          org_id: string
          response_ms: number | null
          site_id: string
          status_code: number | null
        }
        Insert: {
          checked_at?: string
          error?: string | null
          id?: number
          ok: boolean
          org_id: string
          response_ms?: number | null
          site_id: string
          status_code?: number | null
        }
        Update: {
          checked_at?: string
          error?: string | null
          id?: number
          ok?: boolean
          org_id?: string
          response_ms?: number | null
          site_id?: string
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "uptime_checks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uptime_checks_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      uptime_daily: {
        Row: {
          avg_ms: number | null
          checks: number
          day: string
          downtime_seconds: number
          org_id: string
          p95_ms: number | null
          site_id: string
          up: number
          uptime_pct: number
        }
        Insert: {
          avg_ms?: number | null
          checks: number
          day: string
          downtime_seconds?: number
          org_id: string
          p95_ms?: number | null
          site_id: string
          up: number
          uptime_pct: number
        }
        Update: {
          avg_ms?: number | null
          checks?: number
          day?: string
          downtime_seconds?: number
          org_id?: string
          p95_ms?: number | null
          site_id?: string
          up?: number
          uptime_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "uptime_daily_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uptime_daily_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      wp_snapshots: {
        Row: {
          backup_at: string | null
          error: string | null
          measured_at: string | null
          mysql_version: string | null
          org_id: string
          php_version: string | null
          plugins: Json | null
          site_id: string
          theme: string | null
          vulns: Json | null
          wp_update: string | null
          wp_version: string | null
        }
        Insert: {
          backup_at?: string | null
          error?: string | null
          measured_at?: string | null
          mysql_version?: string | null
          org_id: string
          php_version?: string | null
          plugins?: Json | null
          site_id: string
          theme?: string | null
          vulns?: Json | null
          wp_update?: string | null
          wp_version?: string | null
        }
        Update: {
          backup_at?: string | null
          error?: string | null
          measured_at?: string | null
          mysql_version?: string | null
          org_id?: string
          php_version?: string | null
          plugins?: Json | null
          site_id?: string
          theme?: string | null
          vulns?: Json | null
          wp_update?: string | null
          wp_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wp_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wp_snapshots_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_domains_to_check: {
        Args: { _limit?: number }
        Returns: {
          domain: string
          id: string
          org_id: string
        }[]
      }
      get_sites_to_check: {
        Args: never
        Returns: {
          consecutive_failures: number
          expected_string: string
          has_open_incident: boolean
          id: string
          org_id: string
          url: string
        }[]
      }
      insert_expiry_alerts: { Args: never; Returns: undefined }
      persist_uptime: {
        Args: {
          _checks: Json
          _close: string[]
          _counts: Json
          _open: string[]
        }
        Returns: undefined
      }
      rollup_uptime: { Args: { target_day: string }; Returns: undefined }
    }
    Enums: {
      alert_severity: "critical" | "warning" | "info"
      member_role: "owner" | "staff" | "client"
      site_cms: "wordpress" | "other" | "static"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      alert_severity: ["critical", "warning", "info"],
      member_role: ["owner", "staff", "client"],
      site_cms: ["wordpress", "other", "static"],
    },
  },
} as const

