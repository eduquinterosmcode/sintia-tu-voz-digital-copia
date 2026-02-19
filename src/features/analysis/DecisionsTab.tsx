import { AnalysisJson } from "@/hooks/useMeetingBundle";
import EvidenceChip from "@/components/EvidenceChip";

interface DecisionsTabProps {
  analysis: AnalysisJson | null;
  speakerMap?: Record<string, string>;
}

export default function DecisionsTab({ analysis, speakerMap }: DecisionsTabProps) {
  if (!analysis?.decisions?.length) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No se identificaron decisiones en esta reunión.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-display font-semibold text-foreground">Decisiones</h3>
      {analysis.decisions.map((d, i) => (
        <div key={i} className="p-4 rounded-lg border border-border bg-card space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-card-foreground">{d.decision}</p>
          </div>
          {d.owner && (
            <p className="text-xs text-muted-foreground">
              Responsable: <span className="font-medium text-foreground">{d.owner}</span>
            </p>
          )}
          <EvidenceChip evidence={d.evidence} speakerMap={speakerMap} />
        </div>
      ))}
    </div>
  );
}
