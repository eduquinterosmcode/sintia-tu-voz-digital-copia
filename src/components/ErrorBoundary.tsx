import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-6">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h1 className="font-display text-xl font-bold mb-2">Algo salió mal</h1>
          <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
            Ocurrió un error inesperado. Puedes intentar recargar la página.
          </p>
          {this.state.error && (
            <pre className="text-xs text-muted-foreground bg-muted rounded p-3 mb-4 max-w-md overflow-auto">
              {this.state.error.message}
            </pre>
          )}
          <Button onClick={() => window.location.reload()}>Recargar</Button>
        </div>
      );
    }

    return this.props.children;
  }
}
