# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Frontend (apps/web — actualmente en raíz del repo)
npm run dev          # dev server (Vite)
npm run build        # production build
npm run lint         # ESLint
npx tsc --noEmit     # type-check without emitting

# Tests frontend (vitest — cobertura mínima)
npm test             # run once
npm run test:watch   # watch mode

# Supabase CLI (must be linked: npx supabase link --project-ref bpzcogoixzxlzaaijdcr)
npx supabase functions deploy <name> --project-ref bpzcogoixzxlzaaijdcr
npx supabase db push   # apply pending migrations to remote

# AI Service (apps/ai-service/) — requiere Python 3.11+ y uv
cd apps/ai-service
uv sync                                          # instalar dependencias
uv run uvicorn ai_service.main:app --reload      # dev server (port 8000)
uv run pytest                                    # tests
# Migración manual de ai_jobs (una sola vez):
psql $DATABASE_URL -f migrations/001_create_jobs_table.sql
```

Supabase project ref: `bpzcogoixzxlzaaijdcr`

## Architecture Overview

### Stack
React 18 + TypeScript + Vite + Tailwind + shadcn/ui frontend. Supabase (Auth, Postgres, Storage, Edge Functions in Deno) as the entire backend. OpenAI for STT (Whisper / gpt-4o-transcribe) and LLM (GPT-4o).

### Meeting lifecycle
Meetings move through a status machine: `draft → uploaded → transcribed → analyzed → error`.
- **draft**: meeting row created, no audio yet
- **uploaded**: audio stored in `meeting-audio` bucket, `meeting_audio` row inserted
- **transcribed**: `stt-transcribe` Edge Function ran, `meeting_transcripts` + `meeting_segments` rows created
- **analyzed**: `agent-orchestrator` ran, `meeting_analyses` row created
- **error**: STT failed

### Edge Functions (`supabase/functions/`)
All functions handle JWT manually — `verify_jwt = false` in `config.toml` is intentional. Each function creates two Supabase clients: one initialized with the user's `Authorization` header (for `auth.getUser()`), a second with the service role key (for all DB queries, which run as superuser bypassing RLS).

| Function | Purpose |
|----------|---------|
| `get-meeting-bundle` | Fetches meeting + speakers + transcript + segments + analysis + chat in parallel. Used by `useMeetingBundle` hook. |
| `stt-transcribe` | Downloads audio from Storage, calls OpenAI transcription API, inserts `meeting_transcripts` + `meeting_segments`. |
| `agent-orchestrator` | Dual-mode: `analyze` runs the multi-agent pipeline; `chat` does RAG over the transcript. |
| `create-signed-upload-url` | Issues a signed PUT URL for direct browser-to-Storage upload. |
| `create-demo-meeting` | Seeds a demo meeting with pre-built transcript for onboarding. |

### Agent orchestration (`agent-orchestrator`)
Two modes dispatched from the same endpoint via `mode` param:

**`analyze` — Map-Reduce pipeline:**
1. Loads `agent_profiles` for the meeting's sector (coordinator + specialists)
2. Chunks all segments into overlapping windows (`WINDOW_SIZE=60`, `WINDOW_OVERLAP=5`)
3. MAP: runs all specialists in parallel (`Promise.all`) for each window
4. REDUCE: coordinator receives all window results and consolidates into final JSON
5. Saves to `meeting_analyses.analysis_json` + `agent_runs` (for observability)

Single-pass is used when segments fit in one window; Map-Reduce kicks in automatically for longer meetings.

**`chat` — RAG:**
1. Full-text search (`tsvector` on `meeting_segments.text`) to retrieve relevant segments
2. Falls back to chronological segments if no matches
3. Appends last 10 chat messages as history and any existing analysis summary
4. Saves both the user message and assistant response to `chat_messages`

### Sector-based agent routing
`agent_profiles` rows are scoped by `sector_id`. Each meeting has a `sector_id`. The orchestrator loads only the agents for that sector. Two roles: `coordinator` (one per sector) and `specialist` (multiple). Adding a new domain requires only new rows in `sectors` + `agent_profiles` — no code changes.

### Dynamic analysis views (`sectors.view_config_json`)
Each sector stores a `view_config_json` (jsonb) that defines how to render the coordinator's `analysis_json` in the frontend. Schema:
```
{ tabs: [{ key, label, icon, sections: [{ field, type, label?, item? }] }] }
```
`type` is one of `"text"`, `"string_list"`, or `"items_list"`. The `item` mapping tells `ItemsListSection` which JSON fields to use for text, subtitle, owner, date, and badge. Badge values must be `"high" | "medium" | "low"` for automatic color coding.

Frontend entry point: `DynamicAnalysisView.tsx` (standalone widget) or `AnalysisTabContent` + `ICONS` named exports (used inline in `MeetingDetail`). To add a new Lucide icon for a new sector, add it to the `ICONS` registry in `DynamicAnalysisView.tsx`.

### Frontend data flow
- `AuthContext` — Supabase auth session, exposes `user`, `session`, `loading`
- `OrgContext` — fetches the user's org from `org_members` join on user change. One org per user (auto-created by the `handle_new_user` DB trigger on signup)
- `useMeetingBundle` — TanStack Query wrapper around `getMeetingBundle()` in `apiClient.ts`. Returns the full bundle: meeting + speakers + segments + analysis + chat + audio
- Dashboard uses manual `useState` + `useEffect` for its meeting list (not TanStack Query — inconsistency to be aware of)

### API client (`src/services/apiClient.ts`)
All Edge Function calls go through `invokeFunction()` which wraps `supabase.functions.invoke()` and normalizes errors. **Exception**: `getMeetingBundle` uses raw `fetch` with a hardcoded URL constructed from `VITE_SUPABASE_PROJECT_ID` — this requires that env var to be set.

### Database conventions
- All tables have RLS enabled. Org membership is checked via `user_has_org_access(org_id)` (security definer function).
- `meeting_org_id(meeting_id)` is a helper security definer function used in RLS policies for child tables (avoids joins in policies).
- `usage_events` logs every STT and LLM call with token counts. `cost_estimate_usd` is always `null` currently — not yet calculated.
- The `meeting_segments.text_search` column is a generated `tsvector` (Spanish config) used for full-text search in the chat RAG retrieval.

### Rate limiting
`supabase/functions/_shared/rate-limit.ts` uses an in-memory `Map`. Limits reset on cold starts and are not shared across isolate instances — provides basic abuse protection only, not hard enforcement.

### CORS
`supabase/functions/_shared/cors.ts` allowlists `*.lovableproject.com`, `*.lovable.app`, and `localhost`. To allow a custom domain in production, set the `ALLOWED_ORIGINS` environment secret (comma-separated) in Supabase Edge Function secrets.

### DevTestPanel
`src/components/DevTestPanel.tsx` renders in the Dashboard only when `import.meta.env.MODE !== "production"` and `VITE_DEV_TOOLS === "true"` (or in dev mode). It provides an E2E test panel for creating meetings, injecting dummy transcripts, and running analysis without audio.

---

## Roadmap arquitectónico

### Estructura objetivo: monorepo
El repositorio evolucionará a la siguiente estructura. `apps/web/` y `apps/supabase/` corresponden al código actual; `apps/ai-service/` fue creado en la Fase 1.

```
/
├── apps/
│   ├── web/          # frontend React actual (src/, index.html, vite.config.ts, etc.)
│   ├── supabase/     # migraciones y Edge Functions actuales (supabase/)
│   └── ai-service/   # microservicio Python — Fase 1 completa
```

No mover `apps/web/` ni `apps/supabase/` hasta que se decida iniciar la migración a monorepo formalmente.

### Microservicio Python (`apps/ai-service/`) — Fase 1 completa

**Stack:** FastAPI + OpenAI Agents SDK (`openai-agents`) + SQLAlchemy async + asyncpg + Pydantic v2 + pydantic-settings. Empaquetado con `uv` (pyproject.toml), contenedor Docker multi-stage.

**Estructura:**
```
apps/ai-service/
├── src/ai_service/
│   ├── main.py          # FastAPI app, lifespan arranca/detiene el worker
│   ├── config.py        # pydantic-settings, valida DATABASE_URL en startup
│   ├── database.py      # AsyncEngine + AsyncSessionLocal + get_db()
│   ├── jobs/
│   │   ├── models.py    # JobStatus (StrEnum), JobCreate, JobRow
│   │   ├── repository.py # enqueue / claim_next / mark_completed / mark_failed
│   │   └── worker.py    # polling loop + asyncio.Semaphore
│   ├── handlers/
│   │   └── registry.py  # @register_handler("tipo") — punto de extensión
│   └── api/
│       ├── health.py    # GET /health, GET /health/db (sin auth)
│       └── router.py    # POST /jobs/, GET /jobs/{id} (SERVICE_API_KEY)
├── migrations/
│   └── 001_create_jobs_table.sql
└── tests/
    └── test_health.py
```

**Job queue durable (`ai_jobs` tabla en Postgres):**
- `SELECT FOR UPDATE SKIP LOCKED` — múltiples réplicas sin double-processing
- `ON CONFLICT (idempotency_key) DO NOTHING` — enqueue idempotente
- Backoff exponencial en retry: `run_at = NOW() + 2^attempts minutes`
- Status machine: `pending → running → completed | failed → dead`
- `max_attempts` configurable por job (default 3)

**Handler registry:**
```python
from ai_service.handlers.registry import register_handler

@register_handler("analyze_meeting")
async def handle(job: JobRow) -> None:
    ...  # implementar aquí; el worker lo llama automáticamente
```
Registrar un nuevo tipo de job = una función decorada. Sin cambios al worker ni al router.

**Auth:** `SERVICE_API_KEY` estático (bearer token) en todos los endpoints excepto `/health`. Supabase JWT se agrega cuando el servicio sea llamado externamente.

**Variables de entorno requeridas:** `DATABASE_URL` (asyncpg DSN), `OPENAI_API_KEY`, `SERVICE_API_KEY`. Ver `.env.example`.

### Integración con Supabase
El flujo de activación del análisis será:
```
Database Webhook → Edge Function (proxy ligero) → Microservicio Python
```
La Edge Function `agent-orchestrator` actúa como proxy durante la transición; eventualmente quedará solo como webhook receiver que delega al servicio Python.

### Estrategia de migración: Strangler Fig
La migración del orquestador Deno → Python será gradual. El Deno actual sigue funcionando. Nuevas capacidades se implementan en Python primero; el Deno existente no se toca hasta que el Python sea equivalente y estable.

### Agente crítico independiente
Pendiente de definición — será implementado directamente en `apps/ai-service/`, no en el orquestador Deno. Ver discusión en próxima sesión.

### Dominios profesionales configurables por DB
Los sectores soportarán **activation rules** por especialista, configuradas desde la DB (sin cambios de código para agregar un dominio nuevo). El schema exacto de `activation_rules` en `agent_profiles` está pendiente de diseño.
