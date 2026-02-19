import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Pencil, Check, X, Loader2, RefreshCw } from "lucide-react";
import { Segment, Speaker } from "@/hooks/useMeetingBundle";
import { renameSpeaker, transcribeMeeting } from "@/services/apiClient";
import { useToast } from "@/hooks/use-toast";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface TranscriptTabProps {
  meetingId: string;
  segments: Segment[];
  speakers: Speaker[];
  hasAudio: boolean;
  status: string;
  onRefresh: () => void;
}

export default function TranscriptTab({ meetingId, segments, speakers, hasAudio, status, onRefresh }: TranscriptTabProps) {
  const { toast } = useToast();
  const [transcribing, setTranscribing] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [speakerNameInput, setSpeakerNameInput] = useState("");
  const [editingSegment, setEditingSegment] = useState<string | null>(null);
  const [segmentTextInput, setSegmentTextInput] = useState("");

  // Build speaker name map
  const speakerMap: Record<string, string> = {};
  speakers.forEach((s) => {
    speakerMap[s.speaker_label] = s.speaker_name;
  });

  // Get unique speaker labels
  const uniqueSpeakers = [...new Set(segments.map((s) => s.speaker_label))];

  const handleTranscribe = async () => {
    setTranscribing(true);
    try {
      const result = await transcribeMeeting(meetingId);
      toast({ title: "Transcripción completada", description: `${result.segments_count} segmentos generados` });
      onRefresh();
    } catch (err) {
      toast({
        title: "Error de transcripción",
        description: err instanceof Error ? err.message : "Intenta de nuevo",
        variant: "destructive",
      });
    } finally {
      setTranscribing(false);
    }
  };

  const handleRenameSpeaker = async (label: string) => {
    if (!speakerNameInput.trim()) return;
    try {
      await renameSpeaker(meetingId, label, speakerNameInput.trim());
      toast({ title: "Speaker renombrado" });
      setEditingSpeaker(null);
      onRefresh();
    } catch (err) {
      toast({ title: "Error", description: "No se pudo renombrar", variant: "destructive" });
    }
  };

  const getSpeakerColor = (label: string) => {
    const colors = [
      "bg-primary/15 text-primary",
      "bg-accent/15 text-accent",
      "bg-destructive/15 text-destructive",
      "bg-muted text-muted-foreground",
      "bg-secondary text-secondary-foreground",
    ];
    const idx = uniqueSpeakers.indexOf(label);
    return colors[idx % colors.length];
  };

  // No audio yet
  if (!hasAudio && segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-muted-foreground text-sm">No hay audio subido aún. Sube audio desde la página de la reunión.</p>
      </div>
    );
  }

  // Has audio but no transcript
  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
        <p className="text-muted-foreground text-sm">Audio disponible. Haz clic en "Transcribir" para generar la transcripción.</p>
        <Button onClick={handleTranscribe} disabled={transcribing}>
          {transcribing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {transcribing ? "Transcribiendo..." : "Transcribir"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Speaker management */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Speakers:</span>
        {uniqueSpeakers.map((label) => {
          const displayName = speakerMap[label] || label;
          if (editingSpeaker === label) {
            return (
              <div key={label} className="flex items-center gap-1">
                <Input
                  className="h-7 w-32 text-xs"
                  value={speakerNameInput}
                  onChange={(e) => setSpeakerNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRenameSpeaker(label)}
                  autoFocus
                />
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRenameSpeaker(label)}>
                  <Check className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingSpeaker(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          }
          return (
            <button
              key={label}
              onClick={() => { setEditingSpeaker(label); setSpeakerNameInput(displayName); }}
              className="inline-flex items-center gap-1 group"
            >
              <Badge variant="secondary" className={getSpeakerColor(label)}>
                {displayName}
                <Pencil className="h-2.5 w-2.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Badge>
            </button>
          );
        })}
      </div>

      {/* Re-transcribe button */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleTranscribe} disabled={transcribing}>
          {transcribing ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1.5" />}
          Re-transcribir
        </Button>
      </div>

      {/* Segments timeline */}
      <div className="space-y-1">
        {segments.map((seg) => {
          const displayName = speakerMap[seg.speaker_label] || seg.speaker_name || seg.speaker_label;
          return (
            <div key={seg.id} className="flex gap-3 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors group">
              <div className="shrink-0 w-16 text-right">
                <span className="text-xs text-muted-foreground font-mono">{formatTime(seg.t_start_sec)}</span>
              </div>
              <div className="shrink-0">
                <Badge variant="secondary" className={`text-xs ${getSpeakerColor(seg.speaker_label)}`}>
                  {displayName}
                </Badge>
              </div>
              <div className="flex-1 min-w-0">
                {editingSegment === seg.id ? (
                  <div className="space-y-1">
                    <Textarea
                      value={segmentTextInput}
                      onChange={(e) => setSegmentTextInput(e.target.value)}
                      rows={2}
                      className="text-sm"
                    />
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setEditingSegment(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p
                    className="text-sm text-foreground leading-relaxed cursor-pointer"
                    onClick={() => { setEditingSegment(seg.id); setSegmentTextInput(seg.text); }}
                    title="Clic para editar"
                  >
                    {seg.text}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
