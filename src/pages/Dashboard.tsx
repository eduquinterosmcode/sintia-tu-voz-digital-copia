import { useState, useEffect, useRef } from "react";
import DevTestPanel from "@/components/DevTestPanel";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, Search, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrgContext";
import { createDemoMeeting, analyzeMeeting, searchMeetings, MeetingSearchResult } from "@/services/apiClient";
import { useToast } from "@/hooks/use-toast";
import StatusBadge from "@/components/StatusBadge";

function renderSnippet(snippet: string) {
  const parts = snippet.split(/(<b>.*?<\/b>)/g);
  return parts.map((part, i) => {
    const match = part.match(/^<b>(.*?)<\/b>$/);
    if (match) return <b key={i} className="text-foreground font-semibold">{match[1]}</b>;
    return <span key={i}>{part}</span>;
  });
}

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
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [searchResults, setSearchResults] = useState<MeetingSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    supabase.from("sectors").select("id, key, name").then(({ data }) => {
      if (data) setSectors(data);
    });
  }, []);

  const fetchMeetings = async () => {
    if (!org) return;
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

  useEffect(() => {
    fetchMeetings();
  }, [org, sectorFilter, sectors]);

  const isFullTextSearch = search.length >= 3;

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);

    if (!isFullTextSearch || !org) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchDebounce.current = setTimeout(async () => {
      try {
        const results = await searchMeetings(search, org.id);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [search, org, isFullTextSearch]);

  const handleCreateDemo = async () => {
    if (!org || sectors.length === 0) return;
    setCreatingDemo(true);
    try {
      // Pick first available sector
      const sectorKey = sectors[0]?.key || "edificios";
      const result = await createDemoMeeting(org.id, sectorKey);

      if (result.reused) {
        toast({ title: "Demo existente", description: "Abriendo reunión de ejemplo..." });
      } else {
        toast({ title: "Demo creada", description: "Ejecutando análisis automático..." });
        // Auto-analyze
        try {
          await analyzeMeeting(result.meeting_id);
          toast({ title: "Análisis listo", description: "La reunión demo está completa." });
        } catch {
          toast({ title: "Demo creada", description: "Puedes analizar manualmente desde la reunión." });
        }
      }

      navigate(`/meetings/${result.meeting_id}`);
    } catch (err) {
      toast({
        title: "Error al crear demo",
        description: err instanceof Error ? err.message : "Intenta de nuevo",
        variant: "destructive",
      });
    } finally {
      setCreatingDemo(false);
    }
  };

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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleCreateDemo} disabled={creatingDemo} className="gap-2">
            {creatingDemo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {creatingDemo ? "Creando demo..." : "Probar con ejemplo"}
          </Button>
          <Link to="/meetings/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nueva reunión
            </Button>
          </Link>
        </div>
      </div>

      {/* Demo progress banner */}
      {creatingDemo && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-primary/20 bg-primary/5">
          <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Preparando reunión de ejemplo...</p>
            <p className="text-xs text-muted-foreground">Creando transcripción y ejecutando análisis con IA. Esto toma 30-60 segundos.</p>
          </div>
        </div>
      )}

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
        <Select value={sectorFilter} onValueChange={setSectorFilter} disabled={isFullTextSearch}>
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

      {/* Full-text search mode */}
      {isFullTextSearch ? (
        isSearching ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : searchResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h2 className="font-display text-lg font-semibold text-foreground">Sin resultados</h2>
            <p className="text-sm text-muted-foreground mt-1">
              No se encontró «{search}» en ninguna transcripción
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {searchResults.length} reunión{searchResults.length !== 1 ? "es" : ""} con «{search}»
            </p>
            {searchResults.map((r) => (
              <Link
                key={r.meeting_id}
                to={`/meetings/${r.meeting_id}`}
                className="block p-4 rounded-lg border border-border bg-card hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-card-foreground">{r.title}</h3>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {r.sector_name} · {new Date(r.created_at).toLocaleDateString("es-CL")}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {renderSnippet(r.snippet)}
                </p>
              </Link>
            ))}
          </div>
        )
      ) : (
        /* Normal list mode */
        loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h2 className="font-display text-lg font-semibold text-foreground">Sin reuniones aún</h2>
            <p className="text-sm text-muted-foreground mt-1">Crea tu primera reunión o prueba con un ejemplo</p>
            <div className="flex gap-3 mt-4">
              <Button variant="outline" onClick={handleCreateDemo} disabled={creatingDemo} className="gap-2">
                <Sparkles className="h-4 w-4" />
                Probar con ejemplo
              </Button>
              <Link to="/meetings/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nueva reunión
                </Button>
              </Link>
            </div>
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
        )
      )}
      <DevTestPanel />
    </div>
  );
}
