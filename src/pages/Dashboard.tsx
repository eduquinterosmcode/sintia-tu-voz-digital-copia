import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Plus, FileText } from "lucide-react";

const mockMeetings = [
  { id: "1", title: "Reunión directiva Q1", sector: "Negocios", date: "2026-02-18", status: "Completada" },
  { id: "2", title: "Comité de gastos comunes", sector: "Administración de Edificios", date: "2026-02-15", status: "Procesando" },
];

export default function Dashboard() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Resumen de tus reuniones recientes</p>
        </div>
        <Link to="/meetings/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Nueva reunión
          </Button>
        </Link>
      </div>

      {mockMeetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h2 className="font-display text-lg font-semibold text-foreground">Sin reuniones aún</h2>
          <p className="text-sm text-muted-foreground mt-1">Crea tu primera reunión para comenzar</p>
          <Link to="/meetings/new" className="mt-4">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nueva reunión
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {mockMeetings.map((m) => (
            <Link
              key={m.id}
              to={`/meetings/${m.id}`}
              className="flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:bg-secondary/50 transition-colors"
            >
              <div className="space-y-1">
                <h3 className="font-medium text-card-foreground">{m.title}</h3>
                <p className="text-xs text-muted-foreground">{m.sector} · {m.date}</p>
              </div>
              <span className="text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                {m.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
