import { useParams, Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft } from "lucide-react";

const tabPlaceholder = (label: string) => (
  <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
    {label} — Disponible cuando se conecte el backend
  </div>
);

export default function MeetingDetail() {
  const { id } = useParams();

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Volver al dashboard
      </Link>

      <h1 className="font-display text-2xl font-bold text-foreground mb-1">
        Reunión #{id}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Datos de ejemplo · Sector: Negocios
      </p>

      <Tabs defaultValue="transcript">
        <TabsList className="mb-4">
          <TabsTrigger value="transcript">Transcripción</TabsTrigger>
          <TabsTrigger value="analysis">Análisis</TabsTrigger>
          <TabsTrigger value="actions">Acciones</TabsTrigger>
          <TabsTrigger value="risks">Riesgos</TabsTrigger>
          <TabsTrigger value="answers">Respuestas</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript">{tabPlaceholder("Transcripción")}</TabsContent>
        <TabsContent value="analysis">{tabPlaceholder("Análisis")}</TabsContent>
        <TabsContent value="actions">{tabPlaceholder("Acciones")}</TabsContent>
        <TabsContent value="risks">{tabPlaceholder("Riesgos")}</TabsContent>
        <TabsContent value="answers">{tabPlaceholder("Respuestas")}</TabsContent>
        <TabsContent value="chat">{tabPlaceholder("Chat IA")}</TabsContent>
      </Tabs>
    </div>
  );
}
