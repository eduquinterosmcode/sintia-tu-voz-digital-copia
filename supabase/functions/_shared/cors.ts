const ALLOWED_PATTERNS = [
  /^https:\/\/.*\.lovableproject\.com$/,
  /^https:\/\/.*\.lovable\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

function getAllowedOrigins(): RegExp[] {
  const patterns = [...ALLOWED_PATTERNS];
  const extra = Deno.env.get("ALLOWED_ORIGINS");
  if (extra) {
    for (const origin of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
      patterns.push(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    }
  }
  return patterns;
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const baseHeaders: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };

  // No Origin header (server-to-server) → allow
  if (!origin) {
    baseHeaders["Access-Control-Allow-Origin"] = "*";
    return baseHeaders;
  }

  const patterns = getAllowedOrigins();
  if (patterns.some((p) => p.test(origin))) {
    baseHeaders["Access-Control-Allow-Origin"] = origin;
    baseHeaders["Vary"] = "Origin";
    return baseHeaders;
  }

  // Origin not allowed → still return headers but we'll send 403 in handler
  baseHeaders["Access-Control-Allow-Origin"] = "null";
  return baseHeaders;
}

export function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return true; // server-to-server
  const patterns = getAllowedOrigins();
  return patterns.some((p) => p.test(origin));
}

export function handleCorsPreflightOrForbidden(req: Request): Response | null {
  const headers = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (!isOriginAllowed(req)) {
    return new Response(JSON.stringify({ error: "Origen no permitido" }), {
      status: 403,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  return null; // Proceed
}
