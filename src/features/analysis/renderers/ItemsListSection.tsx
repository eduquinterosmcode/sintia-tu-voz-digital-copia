import { Badge } from "@/components/ui/badge";
import EvidenceChip from "@/components/EvidenceChip";
import { cn } from "@/lib/utils";
import type { ItemMapping } from "@/features/analysis/viewConfig.types";
import type { Evidence } from "@/hooks/useMeetingBundle";

const BADGE_STYLES: Record<string, string> = {
  high:   "bg-destructive/15 text-destructive",
  medium: "bg-primary/15 text-primary",
  low:    "bg-muted text-muted-foreground",
};

const BADGE_LABELS: Record<string, string> = {
  high:   "Alto",
  medium: "Medio",
  low:    "Bajo",
};

function get(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

interface ItemsListSectionProps {
  value: unknown;
  item: ItemMapping;
  speakerMap?: Record<string, string>;
}

export default function ItemsListSection({ value, item, speakerMap }: ItemsListSectionProps) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div className="space-y-3">
      {value.map((entry, i) => {
        if (!entry || typeof entry !== "object") return null;
        const obj = entry as Record<string, unknown>;

        const mainText  = item.text     ? String(get(obj, item.text)     ?? "") : "";
        const subtitle  = item.subtitle ? String(get(obj, item.subtitle) ?? "") : "";
        const owner     = item.owner    ? String(get(obj, item.owner)    ?? "") : "";
        const date      = item.date     ? String(get(obj, item.date)     ?? "") : "";
        const badgeVal  = item.badge    ? String(get(obj, item.badge)    ?? "") : "";
        const evidence  = (get(obj, "evidence") ?? []) as Evidence[];

        if (!mainText) return null;

        return (
          <div key={i} className="p-4 rounded-lg border border-border bg-card space-y-2">
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-card-foreground">{mainText}</p>
                {subtitle && (
                  <p className="text-xs text-muted-foreground">{subtitle}</p>
                )}
                {(owner || date) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {owner && <span>👤 {owner}</span>}
                    {date  && <span>📅 {date}</span>}
                  </div>
                )}
              </div>
              {badgeVal && BADGE_STYLES[badgeVal] && (
                <Badge
                  variant="outline"
                  className={cn("text-xs border-0 shrink-0", BADGE_STYLES[badgeVal])}
                >
                  {BADGE_LABELS[badgeVal] ?? badgeVal}
                </Badge>
              )}
            </div>
            {evidence.length > 0 && (
              <EvidenceChip evidence={evidence} speakerMap={speakerMap} />
            )}
          </div>
        );
      })}
    </div>
  );
}
