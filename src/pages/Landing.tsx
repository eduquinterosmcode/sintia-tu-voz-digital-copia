import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles, Shield, Zap } from "lucide-react";

const features = [
  { icon: Sparkles, title: "Transcripción Inteligente", desc: "Convierte tus reuniones en texto con IA avanzada" },
  { icon: Shield, title: "Análisis de Riesgos", desc: "Detecta riesgos y oportunidades automáticamente" },
  { icon: Zap, title: "Acciones Inmediatas", desc: "Genera tareas y seguimientos al instante" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <header className="h-14 flex items-center justify-between px-6 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-display font-bold text-sm">S</span>
          </div>
          <span className="font-display font-bold text-lg">SintIA</span>
        </div>
        <Link to="/auth">
          <Button size="sm">Ingresar</Button>
        </Link>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl text-center space-y-6 animate-fade-in">
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            Inteligencia para tus{" "}
            <span className="text-primary">reuniones</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            Transcribe, analiza y extrae lo importante de cada reunión. 
            Decisiones claras, acciones concretas, riesgos detectados.
          </p>
          <Link to="/auth">
            <Button size="lg" className="px-8 text-base font-semibold mt-2">
              Ingresar
            </Button>
          </Link>
        </div>
      </main>

      {/* Features */}
      <section className="border-t border-border bg-card py-16 px-6">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-3 gap-8">
          {features.map((f) => (
            <div key={f.title} className="text-center space-y-3">
              <div className="mx-auto h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-foreground">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="py-6 text-center text-xs text-muted-foreground border-t border-border">
        © 2026 SintIA. Todos los derechos reservados.
      </footer>
    </div>
  );
}
