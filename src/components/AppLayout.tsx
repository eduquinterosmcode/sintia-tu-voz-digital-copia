import { useState, useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Settings, Menu, X, ChevronDown, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";

const navItems = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Ajustes", to: "/settings", icon: Settings },
];

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { org } = useOrganization();

  const isActive = (path: string) => location.pathname.startsWith(path);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [authLoading, user, navigate]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 border-b border-nav-border bg-nav flex items-center px-4 gap-4 shrink-0 z-30">
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden text-foreground">
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-display font-bold text-sm">S</span>
          </div>
          <span className="font-display font-bold text-lg text-foreground">SintIA</span>
        </Link>

        <div className="flex-1" />

        <span className="hidden sm:inline text-sm text-muted-foreground">
          {org?.name || "Cargando..."}
        </span>

        <Button variant="ghost" size="icon" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground" title="Cerrar sesión">
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          className={cn(
            "fixed lg:static inset-y-14 left-0 z-20 w-56 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-200",
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          )}
        >
          <nav className="flex-1 p-3 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive(item.to)
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        {sidebarOpen && (
          <div className="fixed inset-0 z-10 bg-foreground/20 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <main className="flex-1 overflow-y-auto">
          <div className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
