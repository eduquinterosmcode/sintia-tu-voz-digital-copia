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

## Roadmap de producto (priorizado)

Orden decidido el 2026-03-11 después de análisis de brechas para llegar a producto profesional con usuarios reales.
**Estado al 2026-04-07:** ítems 1–6 completos. Cloud Run activo (Fase 6 completa). Webhook Supabase configurado y validado e2e. App lista para beta cerrada.

| # | Feature | Estado | Razonamiento |
|---|---------|--------|--------------|
| 1 | **Embeddings semánticos en chat** | ✅ completo | RAG con `text-embedding-3-small` + HNSW index. 3 niveles: vector → full-text → cronológico. Script `backfill_embeddings.py` para meetings existentes. |
| 2 | **Storage policies + RBAC básico** | ✅ completo | Políticas RLS tightened (org_provider_settings, organizations, org_members). Edge Function `get-org-members`. SettingsPage con role badge, campos read-only para members, sección Equipo. |
| 3 | **Streaming en chat** | ✅ completo | SSE desde `handleChatStream()` en agent-orchestrator. `streamChatWithMeeting()` en apiClient con fetch directo. ChatTab con cursor parpadeante y acumulación en tiempo real. |
| 4 | **Polling/WebSocket para análisis** | ✅ completo | Fire-and-forget + polling DB-driven. `agent-orchestrator` escribe `status="analyzing"` antes del pipeline LLM. `useMeetingBundle` hace polling cada 3s mientras el status es processing. `MeetingDetail` usa `useRef` para detectar la transición y mostrar toast. El usuario puede navegar libremente. |
| 5 | **Exportación básica (PDF/copy)** | ✅ completo | Botón "Exportar" (outline) en MeetingDetail, visible cuando hay análisis. "Copiar análisis" → Markdown al portapapeles. "Exportar PDF" → ventana nueva con HTML+estilos inline + `window.print()`. Sin dependencias nuevas. Lógica en `src/features/export/exportUtils.ts`. |
| 6 | **Búsqueda entre reuniones** | ✅ completo | RPC `search_meetings` con `plainto_tsquery` sobre índice GIN existente. Dashboard en modo dual: filtro por título (<3 chars) + búsqueda full-text con debounce (≥3 chars). Snippets con términos resaltados via `ts_headline`. |
| 7 | **Whisper chunking >25 min** | pendiente | Reuniones largas bloqueadas en cliente (>25MB). Solución: chunking en `stt-transcribe` (Deno), fragmentos ~10 min con overlap ~5s, transcribir en serie, concatenar timestamps. Cloud Run activo — bloqueador resuelto. |
| 8 | **Diarización automática de speakers** | pendiente | Alta fricción diaria (renombrar SPEAKER_0 manualmente). Decisión pendiente: pyannote.audio self-hosted (gratis, ~2GB RAM, sin GPU) vs Deepgram ($0.26/h) vs AssemblyAI ($0.37/h). Cloud Run activo — bloqueador resuelto. |
| 9 | **Migración especialistas Deno → agentes Python reales** | pendiente | Especialistas actuales son LLM calls directas. Objetivo: Agent-as-Tool pattern con OpenAI Agents SDK. Orden: sector Negocios primero → validar → migrar sector por sector → retirar Deno. |
| 10 | **Tests de integración** | pendiente | Pipeline largo sin cobertura (frontend → Edge Function → Postgres → webhook → Cloud Run → agente). Implementar después de ítem 9 cuando la arquitectura esté estable. Mínimo: un test por Edge Function crítica + validación de job queue end-to-end. |

### Notas de diseño — Ítem 6: Búsqueda entre reuniones

**Qué buscar:** texto libre sobre el contenido de reuniones pasadas (transcripciones + análisis).

**Infraestructura disponible:**
- `meeting_segments.text_search` — columna `tsvector` (config español) ya existente, usada por el chat RAG.
- `meeting_segments` tiene índice GIN sobre `text_search` (creado en migración existente).
- `meeting_analyses.analysis_json` — JSONB, buscable con `jsonb_to_tsvector` o `to_tsvector(analysis_json::text)`.
- Embeddings semánticos ya existen en `meeting_segments` (roadmap ítem 1, completado).

**Estrategia recomendada — todo en frontend + RPC Postgres:**
1. Barra de búsqueda global en el Dashboard (o página `/search` dedicada).
2. Edge Function nueva `search-meetings` o RPC Postgres `search_meetings(query text, org_id uuid)`.
3. La RPC hace `plainto_tsquery('spanish', query)` sobre `meeting_segments.text_search`, agrupa por `meeting_id`, devuelve: `meeting_id`, `title`, `created_at`, `sector`, `snippet` (fragmento relevante con `ts_headline`).
4. Opcionalmente combina con búsqueda en `analysis_json` para encontrar reuniones donde el análisis menciona el término.
5. Resultados: lista de reuniones con snippet resaltado → click navega a `MeetingDetail`.

**RLS:** la RPC debe filtrar por `org_id` del usuario (usar `user_has_org_access(org_id)`).

**Scope mínimo viable:** solo búsqueda full-text sobre transcripciones (segments). La búsqueda semántica (embeddings) queda como mejora posterior.

**Archivos a crear/modificar:**
- `supabase/migrations/YYYYMMDD_search_meetings_rpc.sql` — función `search_meetings`
- `supabase/functions/search-meetings/index.ts` — Edge Function (opcional, la RPC puede llamarse directo desde el cliente con `supabase.rpc()`)
- `src/pages/Dashboard.tsx` — barra de búsqueda + resultados inline o navegación a `/search`
- `src/services/apiClient.ts` — `searchMeetings(query)` wrapper

### Brechas conocidas fuera del roadmap inmediato
- Rate limiter en memoria (no persiste entre instancias) — resolver al activar Cloud Run
- `cost_estimate_usd` siempre null en `usage_events` — necesario para pricing
- Flujo de eliminación de datos (LGPD/Ley 19.628) — prerequisito legal antes de público general
- Cero tests de integración o E2E — riesgo creciente con cada refactor
- Dashboard usa `useState` en vez de TanStack Query — inconsistencia a resolver
- `getMeetingBundle` usa raw `fetch` con URL hardcodeada — único llamado fuera de `apiClient.ts`
- **Supabase Storage límite 50MB (plan gratuito)** — archivos de reuniones largas lo superan fácilmente. Opciones: comprimir audio en el cliente antes de subir (Web Audio API / ffmpeg.wasm), o migrar a plan pro cuando haya usuarios reales.
- **Whisper API límite 25MB por archivo (~25 min de audio)** — solución pendiente: chunking en `stt-transcribe` (dividir en fragmentos de ~10 min con overlap de ~5s, transcribir en serie, concatenar). Requiere Cloud Run activo. **Mitigado para beta:** UI muestra el límite real, validación en cliente bloquea archivos grandes antes de subir, `stt-transcribe` retorna 413 con mensaje descriptivo en lugar de 400 críptico.
- **Leaked Password Protection deshabilitado** — requiere plan Pro de Supabase (no disponible en gratuito). Activar en Dashboard → Authentication → Settings → "Prevent use of leaked passwords" al migrar a Pro.

### Bloqueadores pre-beta resueltos (2026-03-18)

**1. Límite de 25MB de Whisper — mitigado**
- `AudioRecorder.tsx`: constante `WHISPER_MAX_BYTES = 25MB`. Archivo subido: validación inmediata en `handleFileSelect` con toast descriptivo. Audio grabado: detección en `recorder.onstop` con banner de error y bloqueo del botón guardar. Defense-in-depth en `handleSave`. Texto UI corregido de "Máx. 500 MB" → "Máx. 25 MB (~25 min)".
- `stt-transcribe`: check de tamaño post-descarga antes de llamar a Whisper. Retorna 413 con `error_code: "audio_too_large"`, tamaño en MB, y sugerencia de acción. Actualiza status a `error`.
- La solución definitiva (chunking) queda pendiente hasta Cloud Run.

**2. Eliminación de reuniones**
- Migración `20260318200000_meeting_delete_policy.sql`: política DELETE en `meetings` + política DELETE en Storage bucket `meeting-audio` para org members.
- `apiClient.ts`: `deleteMeeting(meetingId)` — busca paths de audio, borra Storage (non-fatal), borra fila meetings (CASCADE elimina todo lo demás).
- `MeetingDetail.tsx`: botón "Eliminar" con `AlertDialog` de confirmación. Visible en todos los estados de la reunión. Post-confirmación navega a `/dashboard`.

### Security Advisor — estado (2026-03-18)

Resueltos en migración `20260318000000_security_advisor_fixes.sql`:

| Severidad | Issue | Resolución |
|-----------|-------|------------|
| Error | Security Definer View: `agent_profiles_public` | Vista recreada con `security_invoker=true` |
| Error | RLS Disabled: `ai_jobs` | RLS habilitado; sin políticas de usuario (acceso solo por service_role/postgres) |
| Error | RLS Disabled: `meeting_quality_reports` | RLS habilitado + política SELECT para org members |
| Warning | Function Search Path Mutable: `match_meeting_segments` | `SET search_path TO public, extensions` (pgvector requiere `extensions` en el path) |
| Warning | Function Search Path Mutable: `ai_jobs_set_updated_at` | `SET search_path = ''` |
| Warning | Function Search Path Mutable: `quality_reports_set_updated_at` | `SET search_path = ''` |

Pendiente (requiere plan Pro):

| Severidad | Issue | Acción |
|-----------|-------|--------|
| Warning | Leaked Password Protection deshabilitado | Dashboard → Authentication → Settings → activar "Prevent use of leaked passwords" |

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
api/webhooks.py    # POST /webhooks/analysis-completed (trigger vía Supabase Webhook)
                   # Nota: el trigger manual POST /audit/{meeting_id} encola job vía la misma queue
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

### Fase 6 — Deploy en Cloud Run

**Estado (2026-04-07): COMPLETA y validada e2e.** Cloud Run activo en `https://sintia-ai-service-hsimetvv7q-uc.a.run.app`. Webhook Supabase configurado (meeting_analyses INSERT → /webhooks/analysis-completed). Flujo completo validado: análisis → webhook → job en ai_jobs → reporte en meeting_quality_reports → tab "Calidad" en la app. Permisos IAM resueltos: Cloud Run Admin API habilitada, iam.serviceAccountUser y secretmanager.secretAccessor en default compute SA.

**Infraestructura GCP creada (sintia-production):**
- Proyecto GCP: `sintia-production`
- Artifact Registry: repositorio `sintia` en `us-central1`
- Workload Identity Federation: pool `github-actions`, provider `github`
- Service Account: `sintia-deploy@sintia-production.iam.gserviceaccount.com`
  - `roles/run.admin`
  - `roles/artifactregistry.writer`
  - `roles/secretmanager.secretAccessor`
- Secret Manager: `sintia-database-url`, `sintia-openai-key`, `sintia-service-api-key`, `sintia-webhook-secret`

**GitHub Secrets configurados** (Settings > Secrets > Actions):
| Secret | Descripción |
|--------|-------------|
| `GCP_PROJECT_ID` | `sintia-production` |
| `GCP_REGION` | `us-central1` |
| `GCP_AR_REPO` | `sintia` |
| `GCP_SERVICE_ACCOUNT` | Email de la service account `sintia-deploy` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Resource name completo del provider WIF |
| `GCP_SA_KEY` | Obsoleto — reemplazado por WIF, puede eliminarse |

**Nota:** El workflow usa Workload Identity Federation (keyless auth) en lugar de JSON key. No hay credenciales de larga duración almacenadas en GitHub. El runner solicita un token OIDC de corta duración que GCP valida contra el repositorio.

**Archivos creados/modificados:**
- `apps/ai-service/Dockerfile` — `COPY uv.lock` + `CMD` respeta `$PORT` (Cloud Run requiere 8080)
- `apps/ai-service/src/ai_service/api/webhooks.py` — `POST /webhooks/analysis-completed`
- `apps/ai-service/src/ai_service/config.py` — campo `webhook_secret`
- `.github/workflows/deploy-ai-service.yml` — CI/CD con WIF: build → push Artifact Registry → deploy Cloud Run

**Secrets en GCP Secret Manager** (nombres exactos usados en el workflow):
- `sintia-database-url` — `DATABASE_URL` asyncpg
- `sintia-openai-key` — `OPENAI_API_KEY`
- `sintia-service-api-key` — `SERVICE_API_KEY`
- `sintia-webhook-secret` — `WEBHOOK_SECRET` (valor libre, guárdalo también en Supabase)

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

---

## Plan de migración: especialistas Deno → agentes Python reales

> **Timing:** Este plan se ejecuta DESPUÉS de completar el roadmap de producto (embeddings, RBAC, streaming, polling, exportación, búsqueda, diarización). El Deno actual sigue funcionando durante toda esa fase.

### Estado actual

Los "especialistas" en el `agent-orchestrator` Deno son llamadas LLM directas: cada especialista es una fila en `agent_profiles` con `system_prompt` y `output_schema_json`. El orquestador les pasa texto del transcript y espera un JSON de vuelta. No son agentes reales — no tienen herramientas, no razonan en múltiples pasos, no pueden buscar evidencia ni hacer llamadas externas.

```
agent-orchestrator (Deno)
  ├── coordinator (LLM call) ← consolida resultados
  └── specialist_N (LLM call) ← prompt + transcript chunk → JSON
```

### Objetivo

Migrar cada especialista a un `Agent` real del OpenAI Agents SDK en Python, con herramientas propias por dominio y capacidad de razonamiento multi-paso. El coordinador pasa a ser un agente que orquesta a los especialistas como subagentes (patrón Agent-as-Tool).

```
agent-orchestrator (Python, apps/ai-service)
  └── CoordinatorAgent
        ├── tool: run_specialist("negocios_resumen")   → NegocionResumenAgent
        ├── tool: run_specialist("negocios_riesgos")   → NegociosRiesgosAgent
        ├── tool: run_specialist("negocios_acciones")  → NegociosAccionesAgent
        └── tool: search_transcript(query)             → segmentos relevantes
```

### Patrón Agent-as-Tool

Cada especialista Python es un `Agent` con sus propias herramientas de dominio:

```python
# Ejemplo: especialista de riesgos para sector Negocios
risks_agent = Agent(
    name="Analista de Riesgos",
    instructions="...",
    tools=[search_transcript, get_speaker_context],
    output_type=RisksOutput,  # Pydantic schema
)

# El coordinador lo usa como herramienta
coordinator = Agent(
    name="Coordinador",
    instructions="...",
    tools=[
        risks_agent.as_tool(name="analizar_riesgos", description="..."),
        actions_agent.as_tool(name="analizar_acciones", description="..."),
        search_transcript,
    ],
    output_type=FinalAnalysisOutput,
)
```

### Ventajas sobre el modelo Deno actual

| Capacidad | Deno actual | Python con Agents SDK |
|-----------|-------------|----------------------|
| Herramientas propias por especialista | ✗ | ✓ |
| Razonamiento multi-paso | ✗ | ✓ |
| Búsqueda de evidencia antes de concluir | ✗ | ✓ |
| Tipado fuerte del output (Pydantic) | parcial (JSON schema) | ✓ |
| Trazabilidad por agente (traces) | manual (agent_runs) | ✓ nativo |
| Specialists por dominio sin cambio de código | ✓ (via DB) | ✓ (via DB + registro) |

### Estructura objetivo en apps/ai-service

```
agents/
├── auditor/          # ya implementado (Fase 2)
├── base/             # herramientas compartidas: search_transcript, get_context
└── sectors/
    ├── negocios/     # CoordinatorAgent + specialists
    ├── legal/
    └── salud/        # cada sector es un módulo independiente
```

### Estrategia de migración (Strangler Fig continuado)

1. Implementar el primer sector completo en Python (ej: Negocios)
2. Agregar job type `analyze_meeting` al worker Python
3. Enrutar solo ese sector al Python; Deno sigue manejando el resto
4. Validar calidad de output vs Deno en meetings reales
5. Migrar sector por sector hasta que todos estén en Python
6. Retirar el orquestador Deno

El enrutamiento sector por sector se hace en `agent-orchestrator` Deno: si `sector.key` está en la lista de sectores migrados, delegar al Python service via HTTP (una vez que esté en Cloud Run); si no, usar el pipeline Deno existente.
