import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: "Borrador", className: "bg-muted text-muted-foreground" },
  uploaded: { label: "Audio subido", className: "bg-secondary text-secondary-foreground" },
  transcribed: { label: "Transcrito", className: "bg-primary/15 text-primary" },
  analyzing: { label: "Analizando...", className: "bg-amber-500/15 text-amber-600" },
  analyzed: { label: "Analizado", className: "bg-accent/15 text-accent" },
  error: { label: "Error", className: "bg-destructive/15 text-destructive" },
};

export default function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || statusConfig.draft;
  return (
    <Badge variant="outline" className={cn("text-xs font-medium border-0", config.className)}>
      {config.label}
    </Badge>
  );
}
