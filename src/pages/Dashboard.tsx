import { useState, useEffect } from "react";
import DevTestPanel from "@/components/DevTestPanel";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import StatusBadge from "@/components/StatusBadge";

interface Meeting {
  id: string;
  title: string;
  status: string;
  created_at: string;
  sectors: { key: string; name: string } | null;
}

export default function Dashboard() {
  const { org, loading: orgLoading } = useOrganization();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [sectors, setSectors] = useState<{ id: string; key: string; name: string }[]>([]);

  useEffect(() => {
    supabase.from("sectors").select("id, key, name").then(({ data }) => {
      if (data) setSectors(data);
    });
  }, []);

  useEffect(() => {
    if (!org) return;
    const fetchMeetings = async () => {
      setLoading(true);
      let query = supabase
        .from("meetings")
        .select("id, title, status, created_at, sector_id, sectors(key, name)")
        .eq("org_id", org.id)
        .order("created_at", { ascending: false });

      if (sectorFilter !== "all") {
        const sectorId = sectors.find((s) => s.key === sectorFilter)?.id;
        if (sectorId) query = query.eq("sector_id", sectorId);
      }

      const { data } = await query;
      setMeetings((data as unknown as Meeting[]) || []);
      setLoading(false);
    };
    fetchMeetings();
  }, [org, sectorFilter, sectors]);

  const filtered = meetings.filter((m) =>
    m.title.toLowerCase().includes(search.toLowerCase())
  );

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

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

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar reuniones..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={sectorFilter} onValueChange={setSectorFilter}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Todos los sectores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los sectores</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
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
          {filtered.map((m) => (
            <Link
              key={m.id}
              to={`/meetings/${m.id}`}
              className="flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:bg-secondary/50 transition-colors"
            >
              <div className="space-y-1">
                <h3 className="font-medium text-card-foreground">{m.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {m.sectors?.name || "—"} · {new Date(m.created_at).toLocaleDateString("es-CL")}
                </p>
              </div>
              <StatusBadge status={m.status} />
            </Link>
          ))}
        </div>
      )}
      <DevTestPanel />
    </div>
  );
}
