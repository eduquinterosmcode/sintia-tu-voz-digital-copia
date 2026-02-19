import { AnalysisJson } from "@/hooks/useMeetingBundle";
import EvidenceChip from "@/components/EvidenceChip";

interface AnalysisSummaryTabProps {
  analysis: AnalysisJson | null;
  speakerMap?: Record<string, string>;
}

export default function AnalysisSummaryTab({ analysis, speakerMap }: AnalysisSummaryTabProps) {
  if (!analysis) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No hay análisis disponible. Ejecuta el análisis desde la pestaña de transcripción.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="space-y-2">
        <h3 className="font-display font-semibold text-foreground">Resumen</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{analysis.summary}</p>
      </div>

      {/* Key Points */}
      {analysis.key_points?.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-semibold text-foreground">Puntos Clave</h3>
          <ul className="space-y-2">
            {analysis.key_points.map((kp, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                <span className="shrink-0 mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                <div className="space-y-1">
                  <span>{kp.point}</span>
                  <div>
                    <EvidenceChip evidence={kp.evidence} speakerMap={speakerMap} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Open Questions */}
      {analysis.open_questions?.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-display font-semibold text-foreground">Preguntas Abiertas</h3>
          <ul className="space-y-1">
            {analysis.open_questions.map((q, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="shrink-0 mt-1">❓</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Confidence Notes */}
      {analysis.confidence_notes?.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-display font-semibold text-foreground text-sm">Notas de Confianza</h3>
          <ul className="space-y-1">
            {analysis.confidence_notes.map((n, i) => (
              <li key={i} className="text-xs text-muted-foreground italic">⚠️ {n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
