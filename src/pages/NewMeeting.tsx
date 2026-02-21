import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AudioRecorder from "@/components/AudioRecorder";

export default function NewMeeting() {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-xl mx-auto animate-fade-in">
      <h1 className="font-display text-2xl font-bold text-foreground mb-6">Nueva Reunión</h1>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Graba o sube el audio de tu reunión</CardTitle>
          <p className="text-sm text-muted-foreground">
            Primero captura el audio, revísalo y luego completa los datos para guardar.
          </p>
        </CardHeader>
        <CardContent>
          <AudioRecorder
            onComplete={(meetingId) => navigate(`/meetings/${meetingId}`)}
            onCancel={() => navigate(-1)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
