import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { createMeeting } from "@/services/apiClient";
import { useToast } from "@/hooks/use-toast";
import AudioRecorder from "@/components/AudioRecorder";

export default function NewMeeting() {
  const navigate = useNavigate();
  const { org } = useOrganization();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [notes, setNotes] = useState("");
  const [sectors, setSectors] = useState<{ id: string; key: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [meetingId, setMeetingId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("sectors").select("id, key, name").then(({ data }) => {
      if (data) setSectors(data);
    });
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !sectorId || !title.trim()) return;
    setCreating(true);
    try {
      const result = await createMeeting(org.id, sectorId, title.trim(), notes || undefined);
      setMeetingId(result.id);
      toast({ title: "Reunión creada", description: "Ahora sube o graba el audio." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "No se pudo crear la reunión",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-6 max-w-xl mx-auto animate-fade-in">
      <h1 className="font-display text-2xl font-bold text-foreground mb-6">Nueva Reunión</h1>

      {!meetingId ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Detalles de la reunión</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input
                  id="title"
                  placeholder="Ej: Reunión directiva Q1"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Sector</Label>
                <Select value={sectorId} onValueChange={setSectorId} required>
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
                <Label htmlFor="notes">Notas (opcional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Contexto adicional sobre la reunión..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => navigate(-1)} className="flex-1">
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1" disabled={creating || !title.trim() || !sectorId}>
                  {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Crear reunión
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Audio de la reunión</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Reunión "<span className="font-medium text-foreground">{title}</span>" creada.
              Ahora graba o sube el audio.
            </p>
            <AudioRecorder
              meetingId={meetingId}
              onUploadComplete={() => navigate(`/meetings/${meetingId}`)}
            />
            <Button variant="link" className="text-sm" onClick={() => navigate(`/meetings/${meetingId}`)}>
              Saltar y subir audio después →
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
