import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Upload, Loader2 } from "lucide-react";
import { getSignedUploadUrl, uploadAudioToStorage, saveMeetingAudio } from "@/services/apiClient";
import { useToast } from "@/hooks/use-toast";

interface AudioRecorderProps {
  meetingId: string;
  onUploadComplete: () => void;
}

export default function AudioRecorder({ meetingId, onUploadComplete }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        await handleUpload(blob, "grabacion.webm", "audio/webm");
      };
      mediaRecorder.current = recorder;
      recorder.start(1000);
      setRecording(true);
      setDuration(0);
      timerRef.current = window.setInterval(() => setDuration((d) => d + 1), 1000);
    } catch {
      toast({ title: "Error", description: "No se pudo acceder al micrófono", variant: "destructive" });
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleUpload(file, file.name, file.type || "audio/mpeg");
  };

  const handleUpload = useCallback(async (blob: Blob, filename: string, mimeType: string) => {
    setUploading(true);
    try {
      const { signed_url, storage_path, token } = await getSignedUploadUrl(meetingId, filename, mimeType);
      await uploadAudioToStorage(signed_url, token, blob, mimeType);
      await saveMeetingAudio(meetingId, storage_path, mimeType, duration || undefined);
      toast({ title: "Audio subido", description: "El archivo se subió correctamente" });
      onUploadComplete();
    } catch (err) {
      toast({
        title: "Error al subir audio",
        description: err instanceof Error ? err.message : "Intenta de nuevo",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }, [meetingId, duration, toast, onUploadComplete]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (uploading) {
    return (
      <div className="border-2 border-dashed border-border rounded-lg p-8 text-center space-y-3">
        <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">Subiendo audio...</p>
      </div>
    );
  }

  return (
    <div className="border-2 border-dashed border-border rounded-lg p-8 text-center space-y-4">
      {recording ? (
        <>
          <div className="flex items-center justify-center gap-3">
            <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
            <span className="text-lg font-mono font-semibold text-foreground">{formatDuration(duration)}</span>
          </div>
          <Button variant="destructive" onClick={stopRecording}>
            <Square className="h-4 w-4 mr-2" />
            Detener grabación
          </Button>
        </>
      ) : (
        <>
          <div className="flex justify-center gap-3">
            <Button onClick={startRecording} variant="outline" className="gap-2">
              <Mic className="h-4 w-4 text-primary" />
              Grabar
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Subir archivo
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">MP3, WAV, M4A, WebM · Máx. 500 MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleFileSelect}
          />
        </>
      )}
    </div>
  );
}
