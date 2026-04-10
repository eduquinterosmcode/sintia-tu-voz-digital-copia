import { useParams, Link, useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Loader2, Play, RefreshCw, ChevronDown, FileText, RotateCcw, Download, Clipboard, Trash2 } from "lucide-react";
import { useMeetingBundle } from "@/hooks/useMeetingBundle";
import { useQueryClient } from "@tanstack/react-query";
import { analyzeMeeting, transcribeMeeting, deleteMeeting } from "@/services/apiClient";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import AudioRecorder from "@/components/AudioRecorder";
import AudioPlayer from "@/components/AudioPlayer";
import TranscriptTab from "@/features/transcript/TranscriptTab";
import { AnalysisTabContent, ICONS } from "@/features/analysis/DynamicAnalysisView";
import AgentRunsTab from "@/features/analysis/AgentRunsTab";
import QualityReportTab from "@/features/analysis/QualityReportTab";
import ChatTab from "@/features/chat/ChatTab";
import { analysisToMarkdown, openPrintWindow } from "@/features/export/exportUtils";

export default function MeetingDetail() {
  const { id } = useParams();
  const { data: bundle, isLoading, error, refetch } = useMeetingBundle(id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  // Track previous status to detect transitions (e.g. analyzing → analyzed)
  const prevStatusRef = useRef<string | undefined>(undefined);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["meeting-bundle", id] });
  };

  // Toast when transcription or analysis completes (status transitions detected via polling)
  useEffect(() => {
    const currentStatus = bundle?.meeting?.status;
    if (prevStatusRef.current === "transcribing" && currentStatus === "transcribed") {
      toast({ title: "Transcripción completada", description: "La reunión ya está transcrita. Puedes analizarla." });
    }
    if (prevStatusRef.current === "analyzing" && currentStatus === "analyzed") {
      toast({ title: "Análisis completado", description: "Los resultados están listos." });
    }
    if (prevStatusRef.current === "analyzing" && currentStatus === "error") {
      toast({ title: "Error en análisis", description: "Revisa los logs del servidor.", variant: "destructive" });
    }
    prevStatusRef.current = currentStatus;
  }, [bundle?.meeting?.status]);

  const handleAnalyze = () => {
    if (!id) return;
    const status = bundle?.meeting?.status;
    const hasSegments = (bundle?.segments?.length ?? 0) > 0;
    const needsTranscription = status === "uploaded" || (!hasSegments && status !== "transcribed" && status !== "analyzed");

    if (needsTranscription) {
      toast({ title: "Procesando en segundo plano", description: "Transcripción → análisis. Puedes seguir navegando." });
      transcribeMeeting(id)
        .then((result) => {
          if (result.queued) {
            // Large file — Python worker handles chunked transcription.
            // Polling via useMeetingBundle ("transcribing" status) will notify when done.
            toast({ title: "Reunión en cola", description: result.message });
            return;
          }
          return analyzeMeeting(id);
        })
        .catch((err) => toast({
          title: "Error al procesar",
          description: err instanceof Error ? err.message : "Intenta de nuevo",
          variant: "destructive",
        }));
    } else {
      toast({ title: "Análisis iniciado", description: "Los agentes están procesando. Puedes seguir navegando." });
      analyzeMeeting(id).catch((err) => toast({
        title: "Error en análisis",
        description: err instanceof Error ? err.message : "Intenta de nuevo",
        variant: "destructive",
      }));
    }
  };

  const handleTranscribeOnly = () => {
    if (!id) return;
    toast({ title: "Transcripción iniciada", description: "Puedes seguir navegando mientras se procesa." });
    transcribeMeeting(id)
      .then((result) => {
        if (result.queued) {
          toast({ title: "Reunión en cola", description: result.message });
          // Polling handles the rest — no manual refetch needed
        } else {
          toast({ title: "Transcripción completada", description: "Puedes revisar la transcripción." });
          refetch();
        }
      })
      .catch((err) => toast({
        title: "Error en transcripción",
        description: err instanceof Error ? err.message : "Intenta de nuevo",
        variant: "destructive",
      }));
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await deleteMeeting(id);
      toast({ title: "Reunión eliminada" });
      navigate("/dashboard");
    } catch (err) {
      toast({
        title: "Error al eliminar",
        description: err instanceof Error ? err.message : "Intenta de nuevo",
        variant: "destructive",
      });
      setDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-20">
        <p className="text-destructive text-sm mb-4">
          {error instanceof Error ? error.message : "Error al cargar la reunión"}
        </p>
        <Button variant="outline" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Reintentar
        </Button>
      </div>
    );
  }

  const { meeting, speakers, segments, analysis, chat_messages, audio, transcript, quality_report } = bundle;
  const analysisJson = (analysis?.analysis_json ?? null) as Record<string, unknown> | null;
  const viewConfig = meeting.sectors?.view_config_json ?? null;

  const handleCopyAnalysis = async () => {
    const md = analysisToMarkdown(bundle, viewConfig);
    await navigator.clipboard.writeText(md);
    toast({ title: "Copiado al portapapeles", description: "El análisis está listo para pegar." });
  };

  const handleExportPdf = () => {
    openPrintWindow(bundle, viewConfig);
  };

  // Build speaker map
  const speakerMap: Record<string, string> = {};
  speakers.forEach((s) => {
    speakerMap[s.speaker_label] = s.speaker_name;
  });

  const isProcessing = meeting.status === "analyzing" || meeting.status === "transcribing";
  const canAnalyze = (meeting.status === "transcribed" || meeting.status === "analyzed" || meeting.status === "uploaded") && (segments.length > 0 || meeting.status === "uploaded");
  const hasTranscript = segments.length > 0;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al dashboard
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{meeting.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {meeting.sectors?.name || "—"} · {new Date(meeting.created_at).toLocaleDateString("es-CL")}
            {meeting.notes && <span className="block mt-0.5 italic">{meeting.notes}</span>}
          </p>
          <div className="flex gap-3 mt-1.5 flex-wrap">
            {transcript && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                Última transcripción: v{transcript.version} · {fmtDate(transcript.created_at)}
              </span>
            )}
            {analysis && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                Último análisis: v{analysis.version} · {fmtDate(analysis.created_at)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={meeting.status} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" disabled={deleting}>
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Eliminar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar esta reunión?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminará el audio, la transcripción y el análisis. Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Sí, eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {analysis && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleCopyAnalysis}>
                  <Clipboard className="h-4 w-4 mr-2" />
                  Copiar análisis
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPdf}>
                  <FileText className="h-4 w-4 mr-2" />
                  Exportar PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {(canAnalyze || isProcessing) && (
            <div className="flex items-center">
              <Button onClick={handleAnalyze} disabled={isProcessing} size="sm" className="rounded-r-none">
                {isProcessing ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Play className="h-3 w-3 mr-1.5" />}
                Analizar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" disabled={isProcessing} className="rounded-l-none border-l border-primary-foreground/20 px-2">
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleTranscribeOnly} disabled={isProcessing}>
                    <FileText className="h-4 w-4 mr-2" />
                    Solo transcribir
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleAnalyze} disabled={isProcessing || !hasTranscript}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Re-analizar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      {/* Audio player or recorder */}
      {audio ? (
        <div className="mb-6">
          <AudioPlayer
            storagePath={audio.storage_path}
            mimeType={audio.mime_type}
            durationSec={audio.duration_sec}
          />
        </div>
      ) : meeting.status === "draft" ? (
        <div className="mb-6">
          <AudioRecorder meetingId={meeting.id} onComplete={handleRefresh} />
        </div>
      ) : null}

      {/* Progress indicators — driven by DB status, survives page refresh */}
      {isProcessing && (
        <div className="mb-4 flex items-center gap-3 p-4 rounded-lg border border-primary/20 bg-primary/5">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {meeting.status === "analyzing" ? "Analizando reunión..." : "Transcribiendo audio..."}
            </p>
            <p className="text-xs text-muted-foreground">
              {meeting.status === "analyzing"
                ? "Los agentes de IA están procesando. Puedes navegar libremente, el análisis continúa en segundo plano."
                : "Convirtiendo audio a texto. Puedes navegar libremente, la transcripción continúa en segundo plano."}
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="transcript">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="transcript">Transcripción</TabsTrigger>
          {viewConfig?.tabs.map((tab) => {
            const Icon = ICONS[tab.icon];
            return (
              <TabsTrigger key={tab.key} value={tab.key} disabled={!analysisJson} className="gap-1.5">
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {tab.label}
              </TabsTrigger>
            );
          })}
          {analysis && (
            <TabsTrigger value="calidad" className="gap-1.5">
              Calidad
              {quality_report && (
                <span className={`text-xs font-bold ${quality_report.confidence_score >= 80 ? "text-emerald-500" : quality_report.confidence_score >= 60 ? "text-amber-500" : "text-destructive"}`}>
                  {quality_report.confidence_score}
                </span>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="agents" disabled={!analysis?.agent_runs}>Agentes</TabsTrigger>
          <TabsTrigger value="chat" disabled={!hasTranscript}>Chat</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript">
          <TranscriptTab
            meetingId={meeting.id}
            segments={segments}
            speakers={speakers}
            hasAudio={!!audio}
            status={meeting.status}
            onRefresh={handleRefresh}
          />
        </TabsContent>
        {viewConfig?.tabs.map((tab) => (
          <TabsContent key={tab.key} value={tab.key}>
            {analysisJson ? (
              <AnalysisTabContent
                sections={tab.sections}
                analysisJson={analysisJson}
                speakerMap={speakerMap}
              />
            ) : (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                No hay análisis disponible. Ejecuta el análisis desde el botón superior.
              </div>
            )}
          </TabsContent>
        ))}
        <TabsContent value="calidad">
          {quality_report ? (
            <QualityReportTab report={quality_report} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
              <p>Auditoría de calidad pendiente.</p>
              <p className="text-xs">El reporte se genera automáticamente después del análisis.</p>
            </div>
          )}
        </TabsContent>
        <TabsContent value="agents">
          <AgentRunsTab agentRuns={analysis?.agent_runs || null} />
        </TabsContent>
        <TabsContent value="chat">
          <ChatTab meetingId={meeting.id} initialMessages={chat_messages} speakerMap={speakerMap} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
