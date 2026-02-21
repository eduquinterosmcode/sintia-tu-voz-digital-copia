import { useState } from "react";
import { ChevronDown, ChevronRight, Bot, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AgentRun {
  agent: string;
  role: string;
  output: Record<string, unknown>;
}

interface AgentRunsTabProps {
  agentRuns: AgentRun[] | null;
}

function JsonBlock({ data, label }: { data: unknown; label: string }) {
  const [open, setOpen] = useState(false);
  const preview = JSON.stringify(data);
  const isLong = preview.length > 200;

  if (!isLong) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap text-foreground">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {label}
      </button>
      {open && (
        <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap text-foreground max-h-96 overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AgentCard({ run, index }: { run: AgentRun; index: number }) {
  const isCoordinator = run.role === "coordinator";
  const outputEntries = Object.entries(run.output || {});

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${isCoordinator ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-2">
        {isCoordinator ? (
          <Crown className="h-4 w-4 text-primary" />
        ) : (
          <Bot className="h-4 w-4 text-muted-foreground" />
        )}
        <h4 className="font-medium text-sm text-card-foreground">{run.agent}</h4>
        <Badge variant={isCoordinator ? "default" : "secondary"} className="text-xs">
          {isCoordinator ? "Coordinador" : `Especialista #${index + 1}`}
        </Badge>
      </div>

      {outputEntries.length > 0 ? (
        <div className="space-y-2">
          {outputEntries.map(([key, value]) => (
            <JsonBlock key={key} label={key} data={value} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Sin output</p>
      )}
    </div>
  );
}

export default function AgentRunsTab({ agentRuns }: AgentRunsTabProps) {
  if (!agentRuns || agentRuns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Bot className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-muted-foreground text-sm">
          No hay datos de ejecución de agentes disponibles.
        </p>
        <p className="text-muted-foreground text-xs mt-1">
          Re-analiza la reunión para generar el registro de agentes.
        </p>
      </div>
    );
  }

  const specialists = agentRuns.filter((r) => r.role === "specialist");
  const coordinator = agentRuns.find((r) => r.role === "coordinator");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display font-semibold text-foreground mb-1">Pipeline Multi-Agente</h3>
        <p className="text-xs text-muted-foreground">
          {specialists.length} especialista{specialists.length !== 1 ? "s" : ""} ejecutado{specialists.length !== 1 ? "s" : ""} en paralelo → 1 coordinador consolidó el resultado final.
        </p>
      </div>

      {/* Specialists */}
      {specialists.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Especialistas (ejecutados en paralelo)
          </h4>
          {specialists.map((run, i) => (
            <AgentCard key={i} run={run} index={i} />
          ))}
        </div>
      )}

      {/* Coordinator */}
      {coordinator && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Coordinador (consolidación final)
          </h4>
          <AgentCard run={coordinator} index={0} />
        </div>
      )}
    </div>
  );
}
