import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, Volume2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AudioPlayerProps {
  storagePath: string;
  mimeType: string | null;
  durationSec: number | null;
}

export default function AudioPlayer({ storagePath, mimeType, durationSec }: AudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchUrl = async () => {
      const { data, error } = await supabase.storage
        .from("meeting-audio")
        .createSignedUrl(storagePath, 3600);
      if (cancelled) return;
      if (error || !data?.signedUrl) {
        setError(true);
      } else {
        setAudioUrl(data.signedUrl);
      }
      setLoading(false);
    };
    fetchUrl();
    return () => { cancelled = true; };
  }, [storagePath]);

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = storagePath.split("/").pop() || "audio";
    a.click();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-card">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Cargando audio...</span>
      </div>
    );
  }

  if (error || !audioUrl) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-card">
        <Volume2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">No se pudo cargar el audio</span>
      </div>
    );
  }

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
      <Volume2 className="h-4 w-4 text-primary shrink-0" />
      <audio controls className="flex-1 h-8" preload="metadata">
        <source src={audioUrl} type={mimeType || "audio/webm"} />
      </audio>
      {durationSec != null && (
        <span className="text-xs text-muted-foreground shrink-0 font-mono">
          {formatDuration(durationSec)}
        </span>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleDownload} title="Descargar audio">
        <Download className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
