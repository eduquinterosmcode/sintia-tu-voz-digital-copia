import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Trash2, ShieldCheck, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrgContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getOrgMembers, type OrgMember } from "@/services/apiClient";

interface ProviderSettings {
  provider: string;
  llm_model: string;
  stt_model: string;
  temperature: number;
  max_output_tokens: number;
  budget_soft_usd: number;
  budget_hard_usd: number;
}

export default function SettingsPage() {
  const { org, updateOrgName } = useOrganization();
  const { user } = useAuth();
  const { toast } = useToast();
  const isOwner = org?.role === "owner";

  const [orgName, setOrgName] = useState("");
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setOrgName(org.name);
      loadSettings();
      loadMembers();
    }
  }, [org]);

  const loadSettings = async () => {
    if (!org) return;
    setSettingsLoading(true);
    const { data } = await supabase
      .from("org_provider_settings")
      .select("*")
      .eq("org_id", org.id)
      .single();
    if (data) {
      setSettings({
        provider: data.provider,
        llm_model: data.llm_model,
        stt_model: data.stt_model,
        temperature: Number(data.temperature),
        max_output_tokens: data.max_output_tokens,
        budget_soft_usd: Number(data.budget_soft_usd),
        budget_hard_usd: Number(data.budget_hard_usd),
      });
    }
    setSettingsLoading(false);
  };

  const loadMembers = async () => {
    setMembersLoading(true);
    try {
      const { members: data } = await getOrgMembers();
      setMembers(data ?? []);
    } catch {
      // non-critical — silently skip
    } finally {
      setMembersLoading(false);
    }
  };

  const handleSaveOrg = async () => {
    setSaving(true);
    try {
      await updateOrgName(orgName);
      toast({ title: "Organización actualizada" });
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!org || !settings) return;
    setSavingSettings(true);
    try {
      const { error } = await supabase
        .from("org_provider_settings")
        .update({
          llm_model: settings.llm_model,
          stt_model: settings.stt_model,
          temperature: settings.temperature,
          max_output_tokens: settings.max_output_tokens,
          budget_soft_usd: settings.budget_soft_usd,
          budget_hard_usd: settings.budget_hard_usd,
        })
        .eq("org_id", org.id);
      if (error) throw error;
      toast({ title: "Configuración guardada" });
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRemoveMember = async (member: OrgMember) => {
    if (!org || member.is_self) return;
    setRemovingId(member.id);
    try {
      const { error } = await supabase
        .from("org_members")
        .delete()
        .eq("id", member.id);
      if (error) throw error;
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      toast({ title: "Miembro eliminado" });
    } catch {
      toast({ title: "Error al eliminar miembro", variant: "destructive" });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Ajustes</h1>
        <p className="text-sm text-muted-foreground">Configura tu organización y proveedores</p>
      </div>

      {/* Organization */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-display text-lg">Organización</CardTitle>
              <CardDescription>Datos de tu organización</CardDescription>
            </div>
            <Badge variant={isOwner ? "default" : "secondary"} className="gap-1">
              {isOwner ? <ShieldCheck className="h-3 w-3" /> : <User className="h-3 w-3" />}
              {isOwner ? "Propietario" : "Miembro"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Nombre</Label>
            <Input
              id="org-name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={!isOwner}
            />
            {!isOwner && (
              <p className="text-xs text-muted-foreground">Solo el propietario puede cambiar el nombre.</p>
            )}
          </div>
          {isOwner && (
            <Button onClick={handleSaveOrg} disabled={saving || orgName === org?.name} variant="outline">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Save className="h-4 w-4 mr-2" />
              Guardar
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Provider Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Proveedor de IA</CardTitle>
          <CardDescription>
            Modelos y parámetros para transcripción y análisis
            {!isOwner && " · Solo lectura"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : settings ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Modelo LLM</Label>
                  <Select
                    value={settings.llm_model}
                    onValueChange={(v) => setSettings({ ...settings, llm_model: v })}
                    disabled={!isOwner}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-5.2">GPT-5.2</SelectItem>
                      <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                      <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Modelo STT</Label>
                  <Select
                    value={settings.stt_model}
                    onValueChange={(v) => setSettings({ ...settings, stt_model: v })}
                    disabled={!isOwner}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-4o-transcribe">GPT-4o Transcribe</SelectItem>
                      <SelectItem value="whisper-1">Whisper-1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Temperatura ({settings.temperature})</Label>
                  <Input
                    type="number" min={0} max={1} step={0.1}
                    value={settings.temperature}
                    onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) || 0 })}
                    disabled={!isOwner}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max tokens de salida</Label>
                  <Input
                    type="number" min={100} max={4000}
                    value={settings.max_output_tokens}
                    onChange={(e) => setSettings({ ...settings, max_output_tokens: parseInt(e.target.value) || 1200 })}
                    disabled={!isOwner}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Presupuesto suave (USD)</Label>
                  <Input
                    type="number" min={0}
                    value={settings.budget_soft_usd}
                    onChange={(e) => setSettings({ ...settings, budget_soft_usd: parseFloat(e.target.value) || 0 })}
                    disabled={!isOwner}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Presupuesto duro (USD)</Label>
                  <Input
                    type="number" min={0}
                    value={settings.budget_hard_usd}
                    onChange={(e) => setSettings({ ...settings, budget_hard_usd: parseFloat(e.target.value) || 0 })}
                    disabled={!isOwner}
                  />
                </div>
              </div>
              {isOwner && (
                <Button onClick={handleSaveSettings} disabled={savingSettings}>
                  {savingSettings && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Save className="h-4 w-4 mr-2" />
                  Guardar configuración
                </Button>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No se encontró configuración</p>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Equipo</CardTitle>
          <CardDescription>
            Miembros de tu organización
            {!isOwner && " · Solo los propietarios pueden gestionar miembros"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No se encontraron miembros.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                      {m.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {m.email}
                        {m.is_self && <span className="ml-1.5 text-xs text-muted-foreground">(tú)</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={m.role === "owner" ? "default" : "secondary"} className="text-xs">
                      {m.role === "owner" ? "Propietario" : "Miembro"}
                    </Badge>
                    {isOwner && !m.is_self && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={removingId === m.id}
                        onClick={() => handleRemoveMember(m)}
                      >
                        {removingId === m.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* User info */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Cuenta</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-foreground">Correo</span>
            <span className="text-sm text-muted-foreground">{user?.email || "—"}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-foreground">Idioma por defecto</span>
            <span className="text-sm text-muted-foreground">es-CL (Español Chile)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
