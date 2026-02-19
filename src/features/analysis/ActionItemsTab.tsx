import { AnalysisJson } from "@/hooks/useMeetingBundle";
import EvidenceChip from "@/components/EvidenceChip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ActionItemsTabProps {
  analysis: AnalysisJson | null;
  speakerMap?: Record<string, string>;
}

const priorityConfig: Record<string, { label: string; className: string }> = {
  high: { label: "Alta", className: "bg-destructive/15 text-destructive" },
  medium: { label: "Media", className: "bg-primary/15 text-primary" },
  low: { label: "Baja", className: "bg-muted text-muted-foreground" },
};

export default function ActionItemsTab({ analysis, speakerMap }: ActionItemsTabProps) {
  if (!analysis?.action_items?.length) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No se identificaron tareas o acciones en esta reunión.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-display font-semibold text-foreground">Acciones / Tareas</h3>
      {analysis.action_items.map((item, i) => {
        const prio = priorityConfig[item.priority] || priorityConfig.medium;
        return (
          <div key={i} className="p-4 rounded-lg border border-border bg-card space-y-2">
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-card-foreground">{item.task}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {item.owner && <span>👤 {item.owner}</span>}
                  {item.due_date && <span>📅 {item.due_date}</span>}
                </div>
              </div>
              <Badge variant="outline" className={cn("text-xs border-0 shrink-0", prio.className)}>
                {prio.label}
              </Badge>
            </div>
            <EvidenceChip evidence={item.evidence} speakerMap={speakerMap} />
          </div>
        );
      })}
    </div>
  );
}
