import { useParams, Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Play, RefreshCw } from "lucide-react";
import { useMeetingBundle, AnalysisJson } from "@/hooks/useMeetingBundle";
import { useQueryClient } from "@tanstack/react-query";
import { analyzeMeeting } from "@/services/apiClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import AudioRecorder from "@/components/AudioRecorder";
import TranscriptTab from "@/features/transcript/TranscriptTab";
import AnalysisSummaryTab from "@/features/analysis/AnalysisSummaryTab";
import DecisionsTab from "@/features/analysis/DecisionsTab";
import ActionItemsTab from "@/features/analysis/ActionItemsTab";
import RisksTab from "@/features/analysis/RisksTab";
import SuggestedResponsesTab from "@/features/analysis/SuggestedResponsesTab";
import ChatTab from "@/features/chat/ChatTab";

export default function MeetingDetail() {
  const { id } = useParams();
  const { data: bundle, isLoading, error, refetch } = useMeetingBundle(id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [analyzing, setAnalyzing] = useState(false);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["meeting-bundle", id] });
  };

  const handleAnalyze = async () => {
    if (!id) return;
    setAnalyzing(true);
    try {
      await analyzeMeeting(id);
      toast({ title: "Análisis completado", description: "Los resultados están listos." });
      handleRefresh();
    } catch (err) {
      toast({
        title: "Error en análisis",
        description: err instanceof Error ? err.message : "Intenta de nuevo",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
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

  const { meeting, speakers, segments, analysis, chat_messages, audio } = bundle;
  const analysisJson = analysis?.analysis_json as AnalysisJson | null;

  // Build speaker map
  const speakerMap: Record<string, string> = {};
  speakers.forEach((s) => {
    speakerMap[s.speaker_label] = s.speaker_name;
  });

  const canAnalyze = meeting.status === "transcribed" && segments.length > 0;
  const hasTranscript = segments.length > 0;

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
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={meeting.status} />
          {canAnalyze && (
            <Button onClick={handleAnalyze} disabled={analyzing} size="sm">
              {analyzing ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Play className="h-3 w-3 mr-1.5" />}
              Analizar
            </Button>
          )}
        </div>
      </div>

      {/* Show audio recorder if no audio */}
      {!audio && meeting.status === "draft" && (
        <div className="mb-6">
          <AudioRecorder meetingId={meeting.id} onUploadComplete={handleRefresh} />
        </div>
      )}

      <Tabs defaultValue="transcript">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="transcript">Transcripción</TabsTrigger>
          <TabsTrigger value="analysis" disabled={!analysisJson}>Resumen</TabsTrigger>
          <TabsTrigger value="decisions" disabled={!analysisJson}>Decisiones</TabsTrigger>
          <TabsTrigger value="actions" disabled={!analysisJson}>Acciones</TabsTrigger>
          <TabsTrigger value="risks" disabled={!analysisJson}>Riesgos</TabsTrigger>
          <TabsTrigger value="responses" disabled={!analysisJson}>Respuestas</TabsTrigger>
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
        <TabsContent value="analysis">
          <AnalysisSummaryTab analysis={analysisJson} speakerMap={speakerMap} />
        </TabsContent>
        <TabsContent value="decisions">
          <DecisionsTab analysis={analysisJson} speakerMap={speakerMap} />
        </TabsContent>
        <TabsContent value="actions">
          <ActionItemsTab analysis={analysisJson} speakerMap={speakerMap} />
        </TabsContent>
        <TabsContent value="risks">
          <RisksTab analysis={analysisJson} speakerMap={speakerMap} />
        </TabsContent>
        <TabsContent value="responses">
          <SuggestedResponsesTab analysis={analysisJson} speakerMap={speakerMap} />
        </TabsContent>
        <TabsContent value="chat">
          <ChatTab meetingId={meeting.id} initialMessages={chat_messages} speakerMap={speakerMap} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
