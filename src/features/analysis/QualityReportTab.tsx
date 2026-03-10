import { ShieldCheck, ShieldAlert, ShieldX, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { MeetingBundle } from "@/hooks/useMeetingBundle";

type QualityReport = NonNullable<MeetingBundle["quality_report"]>["report_json"];

interface Props {
  report: NonNullable<MeetingBundle["quality_report"]>;
}

// ── Score display ────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const { color, Icon, label } =
    score >= 80
      ? { color: "text-emerald-600", Icon: ShieldCheck, label: "Alta confianza" }
      : score >= 60
      ? { color: "text-amber-500", Icon: ShieldAlert, label: "Confianza media" }
      : { color: "text-destructive", Icon: ShieldX, label: "Confianza baja" };

  return (
    <div className="flex items-center gap-4 p-4 rounded-lg border bg-card">
      <Icon className={`h-10 w-10 shrink-0 ${color}`} />
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-4xl font-bold font-display ${color}`}>{score}</p>
        <p className="text-xs text-muted-foreground">/ 100</p>
      </div>
    </div>
  );
}

// ── Severity badge ───────────────────────────────────────────────────────────

const SEVERITY_VARIANT: Record<string, "destructive" | "default" | "secondary"> = {
  high: "destructive",
  medium: "default",
  low: "secondary",
};

const SEVERITY_LABEL: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant={SEVERITY_VARIANT[severity] ?? "secondary"} className="text-xs shrink-0">
      {SEVERITY_LABEL[severity] ?? severity}
    </Badge>
  );
}

// ── Contradictions ───────────────────────────────────────────────────────────

function ContradictionsSection({ items }: { items: QualityReport["contradictions"] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        No se detectaron contradicciones.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((c, i) => (
        <li key={i} className="rounded-lg border p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <SeverityBadge severity={c.severity} />
            <span className="text-xs text-muted-foreground">{c.sources.join(" · ")}</span>
          </div>
          <p className="text-sm">
            <span className="font-medium">A:</span> {c.claim_a}
          </p>
          <p className="text-sm">
            <span className="font-medium">B:</span> {c.claim_b}
          </p>
          <p className="text-xs text-muted-foreground italic">{c.explanation}</p>
        </li>
      ))}
    </ul>
  );
}

// ── Unsupported claims ───────────────────────────────────────────────────────

function UnsupportedSection({ items }: { items: QualityReport["unsupported_claims"] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        Todos los claims tienen respaldo en el transcript.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((u, i) => (
        <li key={i} className="rounded-lg border p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <SeverityBadge severity={u.severity} />
            <span className="text-xs text-muted-foreground">{u.section}</span>
          </div>
          <p className="text-sm font-medium">{u.claim}</p>
          <p className="text-xs text-muted-foreground italic">{u.reason}</p>
        </li>
      ))}
    </ul>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function QualityReportTab({ report }: Props) {
  const { report_json, created_at } = report;
  const totalIssues = report_json.contradictions.length + report_json.unsupported_claims.length;

  return (
    <div className="space-y-6">
      {/* Header row: score + summary */}
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-start">
        <ScoreGauge score={report_json.confidence_score} />
        <div className="p-4 rounded-lg border bg-card space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Resumen de auditoría</p>
          <p className="text-sm leading-relaxed">{report_json.summary}</p>
          <p className="text-xs text-muted-foreground pt-1">
            Generado {new Date(created_at).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            {totalIssues === 0 && " · Sin issues detectados"}
            {totalIssues > 0 && ` · ${totalIssues} issue${totalIssues > 1 ? "s" : ""} detectado${totalIssues > 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* Contradictions */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Contradicciones
          {report_json.contradictions.length > 0 && (
            <Badge variant="outline" className="text-xs">{report_json.contradictions.length}</Badge>
          )}
        </h3>
        <ContradictionsSection items={report_json.contradictions} />
      </section>

      {/* Unsupported claims */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
          <Info className="h-4 w-4 text-blue-500" />
          Claims sin evidencia
          {report_json.unsupported_claims.length > 0 && (
            <Badge variant="outline" className="text-xs">{report_json.unsupported_claims.length}</Badge>
          )}
        </h3>
        <UnsupportedSection items={report_json.unsupported_claims} />
      </section>
    </div>
  );
}
