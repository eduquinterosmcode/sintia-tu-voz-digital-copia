import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Ajustes</h1>
        <p className="text-sm text-muted-foreground">Configura tu cuenta y proveedores</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Proveedor de IA</CardTitle>
          <CardDescription>Configura las claves API para el procesamiento</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input id="api-key" type="password" placeholder="sk-••••••••••••" disabled />
          </div>
          <p className="text-xs text-muted-foreground">Se configurará al conectar el backend</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Límites de Uso</CardTitle>
          <CardDescription>Administra los límites de tu plan</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between py-3 border-b border-border">
            <span className="text-sm text-foreground">Reuniones procesadas</span>
            <span className="text-sm font-medium text-muted-foreground">0 / 50</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-foreground">Minutos de audio</span>
            <span className="text-sm font-medium text-muted-foreground">0 / 500</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Organización</CardTitle>
          <CardDescription>Datos de tu organización</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Nombre</Label>
            <Input id="org-name" placeholder="Mi Organización" />
          </div>
          <Button variant="outline" disabled>Guardar cambios</Button>
        </CardContent>
      </Card>
    </div>
  );
}
