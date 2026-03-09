import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText, CheckSquare, ListChecks, AlertTriangle, MessageSquare,
  HelpCircle, Stethoscope, Scale, HardHat, Users, DollarSign, ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { SectorViewConfig, SectionConfig } from "./viewConfig.types";
import TextSection      from "./renderers/TextSection";
import StringListSection from "./renderers/StringListSection";
import ItemsListSection  from "./renderers/ItemsListSection";

// ── Icon registry ────────────────────────────────────────────
// Add new icons here as new sectors are created.
export const ICONS: Record<string, LucideIcon> = {
  FileText, CheckSquare, ListChecks, AlertTriangle, MessageSquare,
  HelpCircle, Stethoscope, Scale, HardHat, Users, DollarSign, ShieldCheck,
};

// ── Section renderer ─────────────────────────────────────────

interface SectionProps {
  section: SectionConfig;
  analysisJson: Record<string, unknown>;
  speakerMap?: Record<string, string>;
}

function Section({ section, analysisJson, speakerMap }: SectionProps) {
  const value = analysisJson[section.field];

  return (
    <div className="space-y-2">
      {section.label && (
        <h3 className="font-display font-semibold text-foreground">{section.label}</h3>
      )}
      {section.type === "text" && (
        <TextSection value={value} />
      )}
      {section.type === "string_list" && (
        <StringListSection value={value} />
      )}
      {section.type === "items_list" && section.item && (
        <ItemsListSection value={value} item={section.item} speakerMap={speakerMap} />
      )}
    </div>
  );
}

// ── Tab content only (used by MeetingDetail's inline tabs) ──

interface AnalysisTabContentProps {
  sections: SectionConfig[];
  analysisJson: Record<string, unknown>;
  speakerMap?: Record<string, string>;
}

export function AnalysisTabContent({ sections, analysisJson, speakerMap }: AnalysisTabContentProps) {
  return (
    <div className="space-y-6">
      {sections.map((section, i) => (
        <Section key={i} section={section} analysisJson={analysisJson} speakerMap={speakerMap} />
      ))}
    </div>
  );
}

// ── Standalone widget (default export) ───────────────────────

interface DynamicAnalysisViewProps {
  analysisJson: Record<string, unknown> | null;
  viewConfig: SectorViewConfig | null;
  speakerMap?: Record<string, string>;
}

export default function DynamicAnalysisView({
  analysisJson,
  viewConfig,
  speakerMap,
}: DynamicAnalysisViewProps) {
  if (!analysisJson) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No hay análisis disponible. Ejecuta el análisis desde el botón superior.
      </div>
    );
  }

  if (!viewConfig?.tabs?.length) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        Este sector no tiene una vista configurada. Contacta al administrador.
      </div>
    );
  }

  const firstTab = viewConfig.tabs[0].key;

  return (
    <Tabs defaultValue={firstTab}>
      <TabsList className="mb-4 flex-wrap h-auto gap-1">
        {viewConfig.tabs.map((tab) => {
          const Icon = ICONS[tab.icon];
          return (
            <TabsTrigger key={tab.key} value={tab.key} className="gap-1.5">
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {viewConfig.tabs.map((tab) => (
        <TabsContent key={tab.key} value={tab.key}>
          <div className="space-y-6">
            {tab.sections.map((section, i) => (
              <Section
                key={`${tab.key}-${i}`}
                section={section}
                analysisJson={analysisJson}
                speakerMap={speakerMap}
              />
            ))}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
