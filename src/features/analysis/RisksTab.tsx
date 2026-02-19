import { AnalysisJson } from "@/hooks/useMeetingBundle";
import EvidenceChip from "@/components/EvidenceChip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

interface RisksTabProps {
  analysis: AnalysisJson | null;
  speakerMap?: Record<string, string>;
}

const severityConfig: Record<string, { label: string; className: string }> = {
  high: { label: "Alto", className: "bg-destructive/15 text-destructive" },
  medium: { label: "Medio", className: "bg-primary/15 text-primary" },
  low: { label: "Bajo", className: "bg-muted text-muted-foreground" },
};

export default function RisksTab({ analysis, speakerMap }: RisksTabProps) {
  if (!analysis?.risks_alerts?.length) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No se identificaron riesgos o alertas en esta reunión.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        Riesgos y Alertas
      </h3>
      {analysis.risks_alerts.map((r, i) => {
        const sev = severityConfig[r.severity] || severityConfig.medium;
        return (
          <div key={i} className="p-4 rounded-lg border border-border bg-card space-y-2">
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-card-foreground">{r.risk}</p>
                {r.mitigation && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Mitigación:</span> {r.mitigation}
                  </p>
                )}
              </div>
              <Badge variant="outline" className={cn("text-xs border-0 shrink-0", sev.className)}>
                {sev.label}
              </Badge>
            </div>
            <EvidenceChip evidence={r.evidence} speakerMap={speakerMap} />
          </div>
        );
      })}
    </div>
  );
}
