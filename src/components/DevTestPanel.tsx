import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { createMeeting, transcribeMeeting, analyzeMeeting, chatWithMeeting } from "@/services/apiClient";
import { useOrganization } from "@/hooks/useOrganization";
import { Loader2, Bug, ChevronDown, ChevronUp, Activity } from "lucide-react";

interface LogEntry {
  time: string;
  action: string;
  status: "ok" | "error";
  detail: string;
}

// Never show in production builds, even if VITE_DEV_TOOLS leaks
const DEV_ENABLED =
  import.meta.env.MODE !== "production" &&
  (import.meta.env.VITE_DEV_TOOLS === "true" || import.meta.env.DEV);

/** Lightweight check: tries a cheap edge call to detect if OPENAI_API_KEY is configured */
function OpenAIKeyStatus() {
  const [status, setStatus] = useState<"checking" | "ok" | "missing" | "unknown">("checking");

  useEffect(() => {
    supabase.functions.invoke("agent-orchestrator", {
      body: { meeting_id: "00000000-0000-0000-0000-000000000000", mode: "ping" },
    }).then(({ error }) => {
      if (!error) { setStatus("ok"); return; }
      const ctx = (error as any).context;
      const s = ctx?.status;
      if (s === 412) setStatus("missing");
      else if (s === 401 || s === 403) setStatus("unknown");
      else setStatus("ok");
    }).catch(() => setStatus("unknown"));
  }, []);

  const label = status === "checking" ? "verificando…"
    : status === "ok" ? "✅ configurada"
    : status === "missing" ? "❌ NO configurada"
    : "⚠️ no se pudo verificar";

  return (
    <p className="text-xs font-mono text-muted-foreground">
      OPENAI_API_KEY: <span className="text-foreground">{label}</span>
    </p>
  );
}

export default function DevTestPanel() {
  const { org } = useOrganization();
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  if (!DEV_ENABLED) return null;

  const log = (action: string, status: "ok" | "error", detail: string) => {
    setLogs((prev) => [
      { time: new Date().toLocaleTimeString("es-CL"), action, status, detail },
      ...prev,
    ]);
  };

  const handleCreateSample = async (sectorKey: string) => {
    if (!org || busy) return;
    setBusy(true);
    try {
      const { data: sector } = await supabase
        .from("sectors")
        .select("id, name")
        .eq("key", sectorKey)
        .single();
      if (!sector) throw new Error(`Sector "${sectorKey}" no encontrado`);

      const title = `[TEST] ${sector.name} - ${new Date().toLocaleDateString("es-CL")}`;
      const result = await createMeeting(org.id, sector.id, title, "Reunión de prueba generada por Dev Tools");
      setSelectedMeetingId(result.id);
      log("Crear reunión", "ok", `ID: ${result.id} | Sector: ${sector.name}`);
    } catch (err) {
      log("Crear reunión", "error", err instanceof Error ? err.message : JSON.stringify(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDummyTranscript = async () => {
    if (!selectedMeetingId || busy) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Create a dummy transcript
      const { data: tx, error: txErr } = await supabase
        .from("meeting_transcripts")
        .insert({
          meeting_id: selectedMeetingId,
          version: 1,
          provider: "dev-test",
          stt_model: "dummy",
          transcript_text: "Transcripción de prueba generada por Dev Tools.",
          created_by: user.id,
        })
        .select("id")
        .single();
      if (txErr) throw txErr;

      // Create dummy segments
      const dummySegments = [
        { speaker: "SPEAKER_0", start: 0, end: 15, text: "Buenos días a todos. Hoy vamos a revisar el estado del edificio y los gastos comunes del mes." },
        { speaker: "SPEAKER_1", start: 15, end: 30, text: "Gracias. Primero quiero informar que el ascensor ya fue reparado. El costo fue de 450 mil pesos." },
        { speaker: "SPEAKER_0", start: 30, end: 50, text: "Perfecto. ¿Y qué pasa con la filtración del piso 3? Eso lo teníamos pendiente desde el mes pasado." },
        { speaker: "SPEAKER_2", start: 50, end: 70, text: "La empresa de mantención viene la próxima semana. El presupuesto es de 800 mil pesos aproximadamente." },
        { speaker: "SPEAKER_1", start: 70, end: 90, text: "Me preocupa el presupuesto. Ya vamos en un 80% del gasto proyectado y faltan dos meses para cerrar el período." },
        { speaker: "SPEAKER_0", start: 90, end: 110, text: "Propongo que hagamos una reunión extraordinaria con el directorio para evaluar un aumento temporal de gastos comunes." },
        { speaker: "SPEAKER_2", start: 110, end: 125, text: "Estoy de acuerdo. También deberíamos revisar el contrato de seguridad porque vence el próximo mes." },
        { speaker: "SPEAKER_0", start: 125, end: 140, text: "Anotado. Entonces las acciones son: reunión extraordinaria, presupuesto filtración, y renovación contrato seguridad. ¿Algo más?" },
      ];

      const segmentRows = dummySegments.map((s, idx) => ({
        meeting_id: selectedMeetingId,
        transcript_id: tx!.id,
        segment_index: idx,
        speaker_label: s.speaker,
        t_start_sec: s.start,
        t_end_sec: s.end,
        text: s.text,
      }));

      const { error: segErr } = await supabase.from("meeting_segments").insert(segmentRows);
      if (segErr) throw segErr;

      // Create dummy speakers
      await supabase.from("meeting_speakers").upsert([
        { meeting_id: selectedMeetingId, speaker_label: "SPEAKER_0", speaker_name: "Administrador" },
        { meeting_id: selectedMeetingId, speaker_label: "SPEAKER_1", speaker_name: "Tesorero" },
        { meeting_id: selectedMeetingId, speaker_label: "SPEAKER_2", speaker_name: "Presidente Comité" },
      ], { onConflict: "meeting_id,speaker_label" });

      // Update status
      await supabase.from("meetings").update({ status: "transcribed" }).eq("id", selectedMeetingId);

      log("Dummy transcript", "ok", `Transcript: ${tx!.id} | ${dummySegments.length} segmentos creados`);
    } catch (err) {
      log("Dummy transcript", "error", err instanceof Error ? err.message : JSON.stringify(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedMeetingId || busy) return;
    setBusy(true);
    try {
      const result = await analyzeMeeting(selectedMeetingId);
      log("Analizar", "ok", `Analysis ID: ${result.analysis_id} | v${result.version}`);
    } catch (err) {
      log("Analizar", "error", err instanceof Error ? err.message : JSON.stringify(err));
    } finally {
      setBusy(false);
    }
  };

  const handleChatTest = async () => {
    if (!selectedMeetingId || busy) return;
    setBusy(true);
    try {
      const q1 = "¿Cuáles fueron los principales temas tratados en la reunión?";
      const r1 = await chatWithMeeting(selectedMeetingId, q1);
      log("Chat Q1", "ok", `Respuesta: ${r1.message.content.substring(0, 100)}...`);

      const q2 = "¿Qué acciones quedaron pendientes?";
      const r2 = await chatWithMeeting(selectedMeetingId, q2);
      log("Chat Q2", "ok", `Respuesta: ${r2.message.content.substring(0, 100)}...`);
    } catch (err) {
      log("Chat test", "error", err instanceof Error ? err.message : JSON.stringify(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="bg-card border-border shadow-lg"
      >
        <Bug className="h-4 w-4 mr-1.5" />
        Dev Tools
        {open ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronUp className="h-3 w-3 ml-1" />}
      </Button>

      {open && (
        <Card className="absolute bottom-10 right-0 w-96 shadow-xl border-border">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">Panel de Pruebas E2E</CardTitle>
            {selectedMeetingId && (
              <p className="text-xs text-muted-foreground font-mono truncate">
                Meeting: {selectedMeetingId.substring(0, 8)}...
              </p>
            )}
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {/* Diagnostics */}
            <div className="rounded border border-border bg-muted/30 p-2 space-y-1">
              <div className="flex items-center gap-1.5 mb-1">
                <Activity className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Diagnósticos</span>
              </div>
              <p className="text-xs font-mono text-muted-foreground">
                MODE: <span className="text-foreground">{import.meta.env.MODE}</span>
              </p>
              <p className="text-xs font-mono text-muted-foreground">
                DEV_TOOLS: <span className="text-foreground">{import.meta.env.VITE_DEV_TOOLS || "no definido"}</span>
              </p>
              <OpenAIKeyStatus />
            </div>
            <Separator />
            {/* Step 1: Create meeting */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                disabled={busy}
                onClick={() => handleCreateSample("edificios")}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Crear (Edificios)
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                disabled={busy}
                onClick={() => handleCreateSample("negocios")}
              >
                Crear (Negocios)
              </Button>
            </div>

            {/* Step 2-4: Actions on selected meeting */}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" className="flex-1 text-xs" disabled={busy || !selectedMeetingId} onClick={handleDummyTranscript}>
                Dummy Transcript
              </Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" className="flex-1 text-xs" disabled={busy || !selectedMeetingId} onClick={handleAnalyze}>
                Analizar
              </Button>
              <Button size="sm" variant="secondary" className="flex-1 text-xs" disabled={busy || !selectedMeetingId} onClick={handleChatTest}>
                Chat Test (2 msgs)
              </Button>
            </div>

            {/* Log area */}
            <ScrollArea className="h-40 rounded border border-border bg-muted/30 p-2">
              {logs.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Sin logs aún</p>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className="text-xs mb-2 font-mono">
                    <span className="text-muted-foreground">{l.time}</span>{" "}
                    <span className={l.status === "ok" ? "text-accent" : "text-destructive"}>
                      [{l.status.toUpperCase()}]
                    </span>{" "}
                    <span className="font-medium">{l.action}</span>
                    <p className="text-muted-foreground pl-2 break-all">{l.detail}</p>
                  </div>
                ))
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
