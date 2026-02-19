import { AnalysisJson } from "@/hooks/useMeetingBundle";
import EvidenceChip from "@/components/EvidenceChip";
import { MessageSquare } from "lucide-react";

interface SuggestedResponsesTabProps {
  analysis: AnalysisJson | null;
  speakerMap?: Record<string, string>;
}

export default function SuggestedResponsesTab({ analysis, speakerMap }: SuggestedResponsesTabProps) {
  if (!analysis?.suggested_responses?.length) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No hay respuestas sugeridas para esta reunión.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        Respuestas Sugeridas
      </h3>
      {analysis.suggested_responses.map((sr, i) => (
        <div key={i} className="p-4 rounded-lg border border-border bg-card space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contexto</p>
            <p className="text-sm text-foreground">{sr.context}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Mensaje sugerido</p>
            <div className="p-3 rounded-md bg-primary/5 border border-primary/10">
              <p className="text-sm text-foreground leading-relaxed">{sr.message}</p>
            </div>
          </div>
          <EvidenceChip evidence={sr.evidence} speakerMap={speakerMap} />
        </div>
      ))}
    </div>
  );
}
