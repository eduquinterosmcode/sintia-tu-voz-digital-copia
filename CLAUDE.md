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
│   ├── agents/
│   │   └── auditor/     # AnalysisAuditor — ver sección "Agente crítico"
│   ├── handlers/
│   │   └── registry.py  # @register_handler("tipo") — punto de extensión
│   └── api/
│       ├── health.py    # GET /health, GET /health/db (sin auth)
│       ├── audit.py     # POST+GET /audit/{meeting_id} (SERVICE_API_KEY)
│       └── router.py    # agrega auth y agrega sub-routers
├── migrations/
│   ├── 001_create_jobs_table.sql
│   └── 002_create_meeting_quality_reports.sql
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

@register_handler("my_job_type")
async def handle(job: JobRow) -> None:
    ...  # el worker lo llama automáticamente
```
Registrar un nuevo tipo de job = una función decorada. Sin cambios al worker ni al router.
Agregar el import en `handlers/__init__.py` para que se registre al startup.

**Auth:** `SERVICE_API_KEY` estático (bearer token) en todos los endpoints excepto `/health`. Supabase JWT se agrega cuando el servicio sea llamado externamente.

**Variables de entorno requeridas:** `DATABASE_URL` (asyncpg DSN), `OPENAI_API_KEY`, `SERVICE_API_KEY`. Ver `.env.example`.

**Gotchas conocidos (encontrados en e2e):**
- **asyncpg + `::jsonb`**: el operador de cast `::` de PostgreSQL choca con el parser de params nombrados de SQLAlchemy/asyncpg. Siempre usar `CAST(:param AS jsonb)` en queries `text()` — nunca `:param::jsonb`.
- **`OPENAI_API_KEY` no propagada**: `pydantic-settings` lee `.env` en el objeto `settings` pero NO setea `os.environ`. El SDK de OpenAI y `openai-agents` leen directamente de `os.environ`. Fix en `main.py`: `os.environ.setdefault("OPENAI_API_KEY", settings.openai_api_key)` al inicio del módulo.

### Agente crítico independiente — `AnalysisAuditor` (implementado)

Agente transversal a todos los sectores. Corre después del análisis principal como paso adicional del pipeline. **No existe en el orquestador Deno** — primera capacidad nativa del microservicio Python.

**Qué produce:** reporte de calidad con tres componentes:
```json
{
  "confidence_score": 74,
  "contradictions": [
    { "claim_a": "...", "claim_b": "...", "severity": "high", "sources": [...], "explanation": "..." }
  ],
  "unsupported_claims": [
    { "claim": "...", "section": "...", "severity": "medium", "reason": "..." }
  ],
  "summary": "El análisis es mayormente sólido..."
}
```

**Archivos:**
```
agents/auditor/
├── schemas.py     # AuditReport, Contradiction, UnsupportedClaim, Severity
├── agent.py       # Agent[AuditorContext] + search_transcript() tool
├── repository.py  # fetch_meeting_data(), save_report(), get_report()
└── handler.py     # @register_handler("audit_analysis")
api/audit.py       # POST /audit/{meeting_id}, GET /audit/{meeting_id}
migrations/002_create_meeting_quality_reports.sql
```

**Tabla `meeting_quality_reports`:**
- FK a `meetings(id)` y `meeting_analyses(id)`
- `UNIQUE(analysis_id)` — un reporte por versión de análisis; upsert idempotente
- `confidence_score INT`, `report_json JSONB`, `model_used TEXT`

**Flujo:**
```
POST /audit/{meeting_id}              → encola job
GET  /jobs/{job_id}                   → polling de status
GET  /audit/{meeting_id}              → fetch reporte final
```

**Diseño del agente:**
- Segmentos NO van en el prompt — van en `AuditorContext` accesible via `search_transcript()` tool
- DB session cerrada antes de la llamada LLM (no se mantienen conexiones durante inferencia)
- Instrucciones y output en español (Chile)

**Activar en remoto — correr una sola vez:**
```bash
psql $DATABASE_URL -f apps/ai-service/migrations/002_create_meeting_quality_reports.sql
```

### Fase 3 — Integración Deno → Python (completa, validada e2e)

Flujo activo en producción:
```
Frontend → agent-orchestrator (Deno)
               ↓ análisis completado
           INSERT INTO ai_jobs (job_type='audit_analysis')
               ↓ worker polling cada 5s
           Python worker (local / Cloud Run futuro)
               ↓
           meeting_quality_reports
```

**Cambio en Deno** (`agent-orchestrator/index.ts`, función `handleAnalyze`):
Después de `update({ status: "analyzed" })`, inserta en `ai_jobs` via `supabase.upsert()` con `ignoreDuplicates: true`. Fallo no-fatal: error loggeado pero la respuesta de análisis no se ve afectada.

**Desacoplamiento via DB** (Strangler Fig): Deno escribe a `ai_jobs`, Python lee de `ai_jobs`. Sin HTTP directo entre servicios — el Python service ni siquiera necesita estar corriendo en el momento del análisis.

**Validado e2e** (2026-03-10): job encolado → worker pick-up en <5s → agente corrió en ~15s → reporte guardado en `meeting_quality_reports`.

**Siguiente integración (Fase futura):** cuando el servicio esté en Cloud Run, reemplazar el insert directo en `ai_jobs` por un Supabase Database Webhook → `POST /webhooks/analysis-completed`. El Deno quedaría como proxy liviano.

### Estrategia de migración: Strangler Fig
La migración del orquestador Deno → Python será gradual. El Deno actual sigue funcionando. Nuevas capacidades se implementan en Python primero; el Deno existente no se toca hasta que el Python sea equivalente y estable.

### Fase 4 — Frontend del reporte de calidad (completa)

Tab hardcodeado "Calidad" en `MeetingDetail.tsx`. Transversal a todos los sectores — no usa `view_config_json`.

**Archivos:**
- `src/features/analysis/QualityReportTab.tsx` — componente nuevo
- `src/hooks/useMeetingBundle.ts` — `quality_report` agregado al tipo `MeetingBundle`
- `supabase/functions/get-meeting-bundle/index.ts` — `meeting_quality_reports` incluido en el `Promise.all`
- `src/pages/MeetingDetail.tsx` — tab "Calidad" agregado con score inline en el trigger

**Comportamiento:**
- Tab visible solo cuando existe `analysis` para la reunión
- Score mostrado en el tab trigger con color: verde ≥80, ámbar ≥60, rojo <60
- Tres secciones: ScoreGauge · Contradicciones · Claims sin evidencia
- Empty state con ✅ cuando la sección no tiene issues
- Placeholder "Auditoría pendiente" si el reporte aún no fue generado

### Fase 5 — Dominios profesionales configurables por DB (completa)

Campo `activation_rules JSONB` en `agent_profiles`. Backward-compatible: `null` = siempre activar.

**Modos soportados:**
```json
{ "mode": "always" }
{ "mode": "keyword", "keywords": ["contrato", "precio"], "min_matches": 1 }
{ "mode": "segment_count", "min_segments": 20 }
```

**Comportamiento:**
- El orchestrator evalúa las rules contra el transcript completo antes del MAP phase
- Fail-open: si todas las rules filtran todos los especialistas, se usan todos (no falla el análisis)
- Skips y activaciones quedan loggeados en los Edge Function logs

**Archivos modificados:**
- `supabase/functions/agent-orchestrator/index.ts` — interface `ActivationRules`, función `shouldActivateSpecialist()`, filtro en `handleAnalyze()`
- `supabase/migrations/20260310120000_add_activation_rules_to_agent_profiles.sql` — `ALTER TABLE agent_profiles ADD COLUMN activation_rules JSONB`

**Para agregar un nuevo dominio sin código:** insertar filas en `sectors` + `agent_profiles` (con o sin `activation_rules`) — el orchestrator lo toma automáticamente.

### Fase 6 — Deploy en Cloud Run (DIFERIDA INTENCIONALMENTE — no incurrir en costos GCP mientras se sigue desarrollando)

**Decisión:** El código está 100% listo para deploy. Se difiere el setup de GCP (Artifact Registry, Cloud Run, Secret Manager, service account) para evitar costos mientras el producto sigue en desarrollo activo. Cuando se decida activar, solo se necesita el setup manual descrito abajo — sin cambios de código.

**Archivos creados/modificados:**
- `apps/ai-service/Dockerfile` — `COPY uv.lock` + `CMD` respeta `$PORT` (Cloud Run requiere 8080)
- `apps/ai-service/src/ai_service/api/webhooks.py` — `POST /webhooks/analysis-completed`
- `apps/ai-service/src/ai_service/config.py` — campo `webhook_secret`
- `.github/workflows/deploy-ai-service.yml` — CI/CD: build → push a Artifact Registry → deploy a Cloud Run

**GitHub Secrets requeridos** (Settings > Secrets > Actions):
| Secret | Descripción |
|--------|-------------|
| `GCP_PROJECT_ID` | ID del proyecto GCP |
| `GCP_REGION` | Región, ej: `us-central1` |
| `GCP_AR_REPO` | Nombre del repo en Artifact Registry, ej: `sintia` |
| `GCP_SA_KEY` | JSON completo de la service account key |

**Secrets en GCP Secret Manager** (nombres exactos usados en el workflow):
- `sintia-database-url` — `DATABASE_URL` asyncpg
- `sintia-openai-key` — `OPENAI_API_KEY`
- `sintia-service-api-key` — `SERVICE_API_KEY`
- `sintia-webhook-secret` — `WEBHOOK_SECRET` (valor libre, guárdalo también en Supabase)

**Service account mínima** (roles necesarios):
- `roles/run.admin` — deploy Cloud Run
- `roles/artifactregistry.writer` — push imágenes
- `roles/secretmanager.secretAccessor` — leer secrets en runtime

**Una vez desplegado — configurar Supabase Database Webhook:**
1. Supabase Dashboard → Database → Webhooks → Create
2. Table: `meeting_analyses`, Event: `INSERT`
3. URL: `https://<cloud-run-url>/webhooks/analysis-completed`
4. HTTP Headers: `x-webhook-secret: <WEBHOOK_SECRET>`

El endpoint recibe el payload de Supabase (`record.id` = analysis_id, `record.meeting_id`) y encola el job en `ai_jobs`. El worker Python lo procesa igual que antes. El insert Deno en `agent-orchestrator` queda como fallback idempotente (ON CONFLICT DO NOTHING).

**Flujo completo con webhook activo:**
```
Frontend → agent-orchestrator (Deno) → INSERT meeting_analyses
                                              ↓ Supabase Webhook
                                        POST /webhooks/analysis-completed
                                              ↓
                                        ai_jobs (worker polling)
                                              ↓
                                        meeting_quality_reports
```
