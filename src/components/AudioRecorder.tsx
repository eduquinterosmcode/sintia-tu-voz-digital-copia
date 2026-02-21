import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mic, Square, Pause, Play, Upload, Loader2, RotateCcw, Save, AlertTriangle } from "lucide-react";
import { getSignedUploadUrl, uploadAudioToStorage, saveMeetingAudio, createMeeting } from "@/services/apiClient";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

type RecordingState = "idle" | "recording" | "paused" | "stopped";

interface AudioRecorderProps {
  /** If provided, skip the form and just upload to this meeting */
  meetingId?: string;
  onComplete: (meetingId: string) => void;
  onCancel?: () => void;
}

const DURATION_WARNING_SEC = 60 * 60; // 60 minutes
const supportsPause = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.prototype.pause === "function";

export default function AudioRecorder({ meetingId: existingMeetingId, onComplete, onCancel }: AudioRecorderProps) {
  const { org } = useOrganization();
  const { toast } = useToast();

  // Recording state
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [showWarning, setShowWarning] = useState(false);

  // Form state (only used when no existingMeetingId)
  const [title, setTitle] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [notes, setNotes] = useState("");
  const [sectors, setSectors] = useState<{ id: string; key: string; name: string }[]>([]);

  // Upload file state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("record");

  // Saving
  const [saving, setSaving] = useState(false);

  // Refs
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load sectors dynamically
  useEffect(() => {
    if (!existingMeetingId) {
      supabase.from("sectors").select("id, key, name").then(({ data }) => {
        if (data) setSectors(data);
      });
    }
  }, [existingMeetingId]);

  // Clean up audio URLs on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (uploadedFileUrl) URL.revokeObjectURL(uploadedFileUrl);
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Duration warning
  useEffect(() => {
    if (duration >= DURATION_WARNING_SEC && !showWarning) {
      setShowWarning(true);
    }
  }, [duration, showWarning]);

  const startTimer = () => {
    timerRef.current = window.setInterval(() => setDuration((d) => d + 1), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        // Clean previous blob URL
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setState("stopped");
      };

      mediaRecorder.current = recorder;
      recorder.start(1000);
      setState("recording");
      setDuration(0);
      setShowWarning(false);
      startTimer();
    } catch {
      toast({ title: "Error", description: "No se pudo acceder al micrófono. Verifica los permisos.", variant: "destructive" });
    }
  };

  const pauseRecording = () => {
    if (mediaRecorder.current && supportsPause) {
      mediaRecorder.current.pause();
      setState("paused");
      stopTimer();
    }
  };

  const resumeRecording = () => {
    if (mediaRecorder.current && supportsPause) {
      mediaRecorder.current.resume();
      setState("recording");
      startTimer();
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    stopTimer();
    // state will be set to "stopped" in onstop callback
  };

  const recordAgain = () => {
    // Free previous blob
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    chunks.current = [];
    setState("idle");
    setDuration(0);
    setShowWarning(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Free previous URL
    if (uploadedFileUrl) URL.revokeObjectURL(uploadedFileUrl);
    setUploadedFile(file);
    setUploadedFileUrl(URL.createObjectURL(file));
    // Reset file input so the same file can be re-selected
    e.target.value = "";
  };

  const clearUploadedFile = () => {
    if (uploadedFileUrl) URL.revokeObjectURL(uploadedFileUrl);
    setUploadedFile(null);
    setUploadedFileUrl(null);
  };

  // Determine which blob/file to save
  const hasAudioToSave = activeTab === "record" ? !!audioBlob : !!uploadedFile;
  const needsForm = !existingMeetingId;
  const formValid = needsForm ? (title.trim().length > 0 && sectorId.length > 0) : true;
  const canSave = hasAudioToSave && formValid && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);

    try {
      let targetMeetingId = existingMeetingId;
      const blob = activeTab === "record" ? audioBlob! : uploadedFile!;
      const filename = activeTab === "record" ? "grabacion.webm" : uploadedFile!.name;
      const mimeType = activeTab === "record" ? "audio/webm" : (uploadedFile!.type || "audio/mpeg");

      // 1. Create meeting if needed
      if (!targetMeetingId) {
        if (!org) throw new Error("No se encontró la organización.");
        const result = await createMeeting(org.id, sectorId, title.trim(), notes || undefined);
        targetMeetingId = result.id;
      }

      // 2. Update status to 'uploaded'
      const { error: updateError } = await supabase
        .from("meetings")
        .update({ status: "uploaded" })
        .eq("id", targetMeetingId);
      if (updateError) throw updateError;

      // 3. Get signed URL and upload
      const { signed_url, storage_path, token } = await getSignedUploadUrl(targetMeetingId, filename, mimeType);
      await uploadAudioToStorage(signed_url, token, blob, mimeType);

      // 4. Save meeting_audio row
      const audioDuration = activeTab === "record" ? duration : undefined;
      await saveMeetingAudio(targetMeetingId, storage_path, mimeType, audioDuration);

      toast({ title: "Reunión guardada", description: "Audio subido correctamente." });
      onComplete(targetMeetingId);
    } catch (err) {
      toast({
        title: "Error al guardar",
        description: err instanceof Error ? err.message : "Intenta de nuevo",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [canSave, existingMeetingId, activeTab, audioBlob, uploadedFile, org, sectorId, title, notes, duration, toast, onComplete]);

  const formatDuration = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ── Saving overlay ──
  if (saving) {
    return (
      <div className="border-2 border-dashed border-border rounded-lg p-12 text-center space-y-3">
        <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto" />
        <p className="text-sm font-medium text-foreground">Guardando reunión...</p>
        <p className="text-xs text-muted-foreground">Creando reunión y subiendo audio</p>
      </div>
    );
  }

  // ── Recording controls ──
  const renderRecordingArea = () => {
    if (state === "stopped" && audioUrl) {
      return (
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-sm font-medium text-foreground mb-1">Vista previa de la grabación</p>
            <p className="text-xs text-muted-foreground">Duración: {formatDuration(duration)}</p>
          </div>
          <audio controls src={audioUrl} className="w-full" />
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={recordAgain} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Grabar de nuevo
            </Button>
          </div>
        </div>
      );
    }

    if (state === "recording" || state === "paused") {
      return (
        <div className="space-y-4 text-center">
          <div className="flex items-center justify-center gap-3">
            <div className={`h-3 w-3 rounded-full ${state === "recording" ? "bg-destructive animate-pulse" : "bg-muted-foreground"}`} />
            <span className="text-2xl font-mono font-semibold text-foreground">{formatDuration(duration)}</span>
          </div>

          {showWarning && (
            <div className="flex items-center justify-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Grabación de más de 60 minutos. Verifica que todo funcione correctamente.
            </div>
          )}

          <div className="flex justify-center gap-3">
            {supportsPause && (
              state === "recording" ? (
                <Button variant="outline" onClick={pauseRecording} className="gap-2">
                  <Pause className="h-4 w-4" />
                  Pausar
                </Button>
              ) : (
                <Button variant="outline" onClick={resumeRecording} className="gap-2">
                  <Play className="h-4 w-4" />
                  Reanudar
                </Button>
              )
            )}
            <Button variant="destructive" onClick={stopRecording} className="gap-2">
              <Square className="h-4 w-4" />
              Detener
            </Button>
          </div>

          {state === "paused" && (
            <p className="text-xs text-muted-foreground">Grabación en pausa</p>
          )}
        </div>
      );
    }

    // Idle state
    return (
      <div className="text-center space-y-4">
        <div className="space-y-2">
          <Mic className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Presiona para comenzar a grabar</p>
        </div>
        <Button onClick={startRecording} size="lg" className="gap-2">
          <Mic className="h-4 w-4" />
          Iniciar grabación
        </Button>
      </div>
    );
  };

  // ── Upload tab ──
  const renderUploadArea = () => {
    if (uploadedFile && uploadedFileUrl) {
      return (
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-sm font-medium text-foreground mb-1">{uploadedFile.name}</p>
            <p className="text-xs text-muted-foreground">
              {(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          </div>
          <audio controls src={uploadedFileUrl} className="w-full" />
          <div className="flex justify-center">
            <Button variant="outline" onClick={clearUploadedFile} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Elegir otro archivo
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="text-center space-y-4">
        <div className="space-y-2">
          <Upload className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Selecciona un archivo de audio</p>
          <p className="text-xs text-muted-foreground">MP3, WAV, M4A, WebM · Máx. 500 MB</p>
        </div>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
          <Upload className="h-4 w-4" />
          Seleccionar archivo
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    );
  };

  // ── Form fields (only when creating new meeting) ──
  const renderForm = () => {
    if (!needsForm) return null;

    return (
      <div className="space-y-4 border-t border-border pt-5">
        <h3 className="text-sm font-semibold text-foreground">Detalles de la reunión</h3>

        <div className="space-y-2">
          <Label htmlFor="rec-title">Nombre de la reunión *</Label>
          <Input
            id="rec-title"
            placeholder="Ej: Reunión directiva Q1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Sector *</Label>
          <Select value={sectorId} onValueChange={setSectorId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un sector" />
            </SelectTrigger>
            <SelectContent>
              {sectors.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="rec-notes">Notas (opcional)</Label>
          <Textarea
            id="rec-notes"
            placeholder="Contexto adicional sobre la reunión..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="record" className="flex-1 gap-2" disabled={state === "recording" || state === "paused"}>
            <Mic className="h-4 w-4" />
            Grabar
          </TabsTrigger>
          <TabsTrigger value="upload" className="flex-1 gap-2" disabled={state === "recording" || state === "paused"}>
            <Upload className="h-4 w-4" />
            Subir archivo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="record">
          <div className="border-2 border-dashed border-border rounded-lg p-8">
            {renderRecordingArea()}
          </div>
        </TabsContent>

        <TabsContent value="upload">
          <div className="border-2 border-dashed border-border rounded-lg p-8">
            {renderUploadArea()}
          </div>
        </TabsContent>
      </Tabs>

      {renderForm()}

      {/* Action buttons */}
      <div className="flex gap-3">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="flex-1"
            disabled={state === "recording" || state === "paused"}
          >
            Cancelar
          </Button>
        )}
        <Button
          onClick={handleSave}
          disabled={!canSave}
          className="flex-1 gap-2"
        >
          <Save className="h-4 w-4" />
          Guardar reunión
        </Button>
      </div>
    </div>
  );
}
