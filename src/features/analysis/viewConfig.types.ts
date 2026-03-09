// ── View Config Types ────────────────────────────────────────
//
// These types mirror the view_config_json stored in the sectors
// table. The frontend uses this config to render analysis results
// dynamically — no hardcoded tabs per sector.
//
// Adding a new domain (medical, legal, etc.) requires only:
//   1. A new row in `sectors` with view_config_json
//   2. Agent profiles for that sector in `agent_profiles`
// Zero frontend code changes needed.

export type SectionType = "text" | "string_list" | "items_list";

export interface ItemMapping {
  /** Field name in the analysis object for the main text (required) */
  text: string;
  /** Field name for secondary descriptive text, shown smaller below */
  subtitle?: string;
  /** Field name for the owner/responsible person (renders with 👤) */
  owner?: string;
  /** Field name for a date value (renders with 📅) */
  date?: string;
  /**
   * Field name for a badge value.
   * The value at runtime must be "high" | "medium" | "low".
   * The renderer maps these automatically:
   *   high   → red   (destructive)
   *   medium → blue  (primary)
   *   low    → gray  (muted)
   */
  badge?: string;
}

export interface SectionConfig {
  /** Key in analysis_json to read data from */
  field: string;
  /** How to render this field */
  type: SectionType;
  /** Optional heading shown above the section */
  label?: string;
  /** Required when type is "items_list" */
  item?: ItemMapping;
}

export interface TabConfig {
  /** Unique identifier used as the Tabs value */
  key: string;
  /** Display label on the tab trigger */
  label: string;
  /**
   * Lucide icon name (string).
   * Supported: FileText, CheckSquare, ListChecks, AlertTriangle,
   *            MessageSquare, HelpCircle, Stethoscope, Scale,
   *            HardHat, Users, DollarSign, ShieldCheck
   */
  icon: string;
  sections: SectionConfig[];
}

export interface SectorViewConfig {
  tabs: TabConfig[];
}
