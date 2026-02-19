import { useState } from "react";
import { Evidence } from "@/hooks/useMeetingBundle";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Quote } from "lucide-react";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface EvidenceChipProps {
  evidence: Evidence[];
  speakerMap?: Record<string, string>;
}

export default function EvidenceChip({ evidence, speakerMap }: EvidenceChipProps) {
  if (!evidence || evidence.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors cursor-pointer">
          <Quote className="h-3 w-3" />
          {evidence.length} evidencia{evidence.length > 1 ? "s" : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3 border-b border-border">
          <h4 className="text-sm font-semibold text-foreground">Evidencia del transcrito</h4>
        </div>
        <div className="max-h-60 overflow-y-auto divide-y divide-border">
          {evidence.map((e, i) => {
            const displayName = speakerMap?.[e.speaker] || e.speaker;
            return (
              <div key={i} className="p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs font-medium">
                    {displayName}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(e.t_start_sec)} – {formatTime(e.t_end_sec)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground italic leading-relaxed">
                  "{e.quote}"
                </p>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
