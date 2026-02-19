import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, Upload } from "lucide-react";

export default function NewMeeting() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [sector, setSector] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Stub: redirect to a mock meeting
    navigate("/meetings/new-1");
  };

  return (
    <div className="p-6 max-w-xl mx-auto animate-fade-in">
      <h1 className="font-display text-2xl font-bold text-foreground mb-6">Nueva Reunión</h1>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Detalles de la reunión</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Título</Label>
              <Input
                id="title"
                placeholder="Ej: Reunión directiva Q1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Sector</Label>
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un sector" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="edificios">Administración de Edificios</SelectItem>
                  <SelectItem value="negocios">Negocios</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Audio de la reunión</Label>
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center space-y-3">
                <div className="flex justify-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Mic className="h-5 w-5 text-primary" />
                  </div>
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Arrastra un archivo de audio o haz clic para seleccionar
                </p>
                <p className="text-xs text-muted-foreground">
                  MP3, WAV, M4A · Máx. 500 MB
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)} className="flex-1">
                Cancelar
              </Button>
              <Button type="submit" className="flex-1">
                Crear reunión
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
