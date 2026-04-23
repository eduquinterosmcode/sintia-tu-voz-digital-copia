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
Meetings move through a status machine: `draft → uploaded → [transcribing →] transcribed → analyzed → error`.
- **draft**: meeting row created, no audio yet
- **uploaded**: audio stored in `meeting-audio` bucket, `meeting_audio` row inserted
- **transcribing**: audio >25 MB — job enqueued in `ai_jobs`, Python worker processing (chunked path)
- **transcribed**: transcript ready — either via `stt-transcribe` direct (≤25 MB) or Python worker (>25 MB)
- **analyzing**: `agent-orchestrator` running the multi-agent pipeline
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

**Estado al 2026-04-23:** ítems 1–7 y 9 completos. Cloud Run activo. App lista para beta cerrada. Próximos: deploy de frontend a producción (ítem 11) + control de acceso beta (ítem 12) + tests de integración (ítem 10).

| # | Feature | Estado | Razonamiento |
|---|---------|--------|--------------|
| 1 | **Embeddings semánticos en chat** | ✅ completo | RAG tri-nivel: vector (`text-embedding-3-small` + HNSW) → full-text → cronológico. |
| 2 | **Storage policies + RBAC básico** | ✅ completo | RLS tightened + `get-org-members` Edge Function + SettingsPage con roles. |
| 3 | **Streaming en chat** | ✅ completo | SSE desde `handleChatStream()` + `streamChatWithMeeting()` en apiClient. |
| 4 | **Polling/WebSocket para análisis** | ✅ completo | Fire-and-forget + polling DB cada 3s. Usuario navega libremente durante análisis. |
| 5 | **Exportación básica (PDF/copy)** | ✅ completo | "Copiar análisis" → Markdown. "Exportar PDF" → HTML+print. `exportUtils.ts`. |
| 6 | **Búsqueda entre reuniones** | ✅ completo | RPC `search_meetings` + `plainto_tsquery` + `ts_headline` snippets (XSS-safe). |
| 7 | **Whisper chunking >25 min** | ✅ completo | `stt-transcribe` detecta >25 MB → encola job. Python worker: ffmpeg chunks → whisper-1 → merge → embeddings. |
| 8 | **Diarización automática de speakers** | pendiente | Postergada hasta feedback beta. Decisión técnica pendiente: pyannote.audio vs Deepgram ($0.26/h) vs AssemblyAI ($0.37/h). |
| 9 | **Migración especialistas Deno → agentes Python reales** | ✅ completo | 7 sectores migrados (business, building_admin, ventas, legal, civil, metalurgia, salud). 37 agent_profiles. Pipeline e2e validado en sector "business". |
| 10 | **Tests de integración** | pendiente | Mínimo: un test por Edge Function crítica + job queue e2e. |
| 11 | **Deploy frontend a producción** | pendiente | Vercel (recomendado) o Cloudflare Pages. Requiere configurar env vars, CORS, y redirect URLs en Supabase Auth. |
| 12 | **Control de acceso beta cerrada** | pendiente | Dos partes: (a) signups deshabilitados + invitación manual, (b) límite 1-2 dispositivos por cuenta via Edge Function + `auth.sessions`. |

### Brechas conocidas fuera del roadmap inmediato
- Rate limiter en memoria (no persiste entre instancias) — resolver al escalar
- `cost_estimate_usd` siempre null en `usage_events` — necesario para pricing
- Flujo de eliminación de datos (LGPD/Ley 19.628) — prerequisito legal antes de público general
- Cero tests de integración o E2E — riesgo creciente con cada refactor
- Dashboard usa `useState` en vez de TanStack Query — inconsistencia a resolver
- `getMeetingBundle` usa raw `fetch` con URL hardcodeada — único llamado fuera de `apiClient.ts`
- **Supabase Storage límite 50MB (plan gratuito)** — archivos de reuniones largas lo superan fácilmente. Comprimir audio en el cliente o migrar a plan Pro.
- **Leaked Password Protection deshabilitado** — requiere plan Pro. Activar en Dashboard → Authentication → Settings → "Prevent use of leaked passwords".

---

## Plan de lanzamiento beta cerrada (ítems 11 y 12)

### Ítem 11 — Deploy frontend a producción

**Recomendación: Vercel** (alternativa: Cloudflare Pages)

Vercel detecta Vite automáticamente, tiene integración GitHub (deploy por push + preview URLs por PR), dominio gratuito `*.vercel.app` hasta tener dominio propio, y CLI para deploys manuales.

**Checklist de deploy:**
1. `npm run build` — verificar que el build local no tiene errores de TypeScript ni ESLint
2. Crear proyecto en Vercel y conectar el repositorio GitHub
3. Configurar env vars en Vercel (Settings → Environment Variables):
   ```
   VITE_SUPABASE_URL=<url del proyecto Supabase>
   VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
   VITE_SUPABASE_PROJECT_ID=bpzcogoixzxlzaaijdcr
   VITE_DEV_TOOLS=false
   ```
4. Agregar la URL de producción (`https://<proyecto>.vercel.app`) a Supabase Auth:
   - Dashboard → Authentication → URL Configuration → Site URL
   - Dashboard → Authentication → URL Configuration → Redirect URLs (agregar `https://<proyecto>.vercel.app/**`)
5. Agregar la URL al CORS de Edge Functions:
   - Supabase Dashboard → Edge Functions → Secrets → `ALLOWED_ORIGINS`
   - Valor: `https://<proyecto>.vercel.app` (si hay múltiples, separar por coma)
   - **Redeploy todas las Edge Functions** después de cambiar el secret
6. Verificar que `lovable-tagger` (plugin en `vite.config.ts`) solo corre en `development` mode — ya está condicional, no requiere cambio

**Gotcha clave:** `getMeetingBundle` en `apiClient.ts` usa raw `fetch` con URL construida desde `VITE_SUPABASE_PROJECT_ID`. Esta es la única llamada fuera de `supabase.functions.invoke()` y depende de que ese env var esté seteado correctamente en producción.

**Alternativa Cloudflare Pages:** misma configuración de env vars, pero CORS no requiere secret adicional si se agrega el dominio directamente al array `ALLOWED_PATTERNS` en `cors.ts`. Mejor rendimiento global pero DX ligeramente menor.

---

### Ítem 12 — Control de acceso beta cerrada

**Dos componentes independientes:**

#### 12a — Signups deshabilitados (invitación manual)

1. Supabase Dashboard → Authentication → Settings → desactivar **"Enable user signups"**
2. Invitar usuarios manualmente:
   - Opción A (Dashboard): Authentication → Users → "Invite user" → ingresa email
   - Opción B (código): `supabase.auth.admin.inviteUserByEmail(email)` desde cualquier entorno con service role key
3. El usuario recibe email con magic link. Al hacer click, puede setear contraseña.
4. Si alguien intenta registrarse por su cuenta, Supabase devuelve error — no hay código que cambiar en el frontend (Supabase lo bloquea a nivel Auth).

> Este paso se puede hacer **ahora mismo** desde el Dashboard — sin código, sin deploy.

#### 12b — Límite de dispositivos (1-2 por cuenta)

**Enfoque técnico:** Edge Function `check-session-limit` que inspecciona `auth.sessions` con service role key.

Supabase mantiene una tabla interna `auth.sessions` accesible con service role. La lógica:
1. Al montar la app (en `AuthContext`), llamar a una Edge Function `enforce-session-limit`
2. La función cuenta las sesiones activas del usuario en `auth.sessions`
3. Si hay más de `MAX_SESSIONS` (= 2), invalida las más antiguas llamando a `supabase.auth.admin.signOut(userId, { scope: 'others' })` o eliminando filas de `auth.sessions` directamente
4. La sesión actual (la del request) no se invalida

**Diseño de la Edge Function:**
```typescript
// POST /enforce-session-limit
// Headers: Authorization: Bearer <user JWT>
// Consulta auth.sessions y elimina sesiones antiguas si > MAX_SESSIONS
const MAX_SESSIONS = 2;
// Usar serviceRoleClient para leer auth.sessions
// SELECT id, user_id, created_at FROM auth.sessions WHERE user_id = $1 ORDER BY created_at DESC
// Si COUNT > MAX_SESSIONS, DELETE WHERE id IN (sesiones más antiguas)
```

**Alternativa más simple para el arranque de beta:** no implementar el límite de dispositivos en código — simplemente monitorear manualmente y revocar sesiones desde el Dashboard (Authentication → Users → seleccionar usuario → Sessions → Revoke). Suficiente para una beta de 10-20 usuarios.

**Orden de implementación sugerido:**
1. Deshabilitar signups (5 min, cero código) ← hacer primero
2. Deploy frontend en Vercel (30-60 min)
3. Implementar límite de dispositivos si hay señales de abuso durante beta

---

## Rotación de secretos — procedimiento validado (sesión 5, 2026-04-16)

> **NOTA:** Ninguna Edge Function de Supabase lee `WEBHOOK_SECRET`.
> Validado con grep exhaustivo en sesión 5 (2026-04-16). El paso que mencionaba
> actualizar `WEBHOOK_SECRET` en Supabase Edge Functions Secrets era incorrecto —
> ese secret nunca existió ahí y ninguna función Deno lo usa.

> **NOTA TÉCNICA — pinning de `:latest` en Cloud Run:**
> El workflow usa `sintia-webhook-secret:latest` en `--set-secrets`.
> GCP resuelve `:latest` a la versión concreta **en el momento del deploy**
> y la pina en esa revisión. Las instancias en ejecución no se actualizan
> automáticamente al crear una nueva versión en Secret Manager.
> **Cualquier rotación de secretos REQUIERE un redeploy de Cloud Run.**
>
> Este comportamiento es también una red de seguridad: la revisión activa
> sigue usando la versión pinada hasta que el nuevo deploy complete
> exitosamente. El sistema no rompe al crear una nueva versión en Secret
> Manager — solo rompe si se completan tanto el redeploy como la actualización
> del webhook header con el nuevo valor. Esto da una ventana segura: puedes
> hacer el redeploy y actualizar el webhook en momentos distintos sin riesgo
> de downtime.

### Procedimiento (para `sintia-webhook-secret` y cualquier otro secret de Cloud Run)

1. **Generar nuevo valor**
   ```bash
   openssl rand -base64 32
   ```

2. **GCP Secret Manager** → proyecto `sintia-production` → secret objetivo
   → *Add new version* → pegar valor → marcar *Disable all past versions*

3. **Redeploy Cloud Run** para que pine la nueva versión
   - Opción A (recomendada para rotaciones futuras): GitHub → Actions →
     *Deploy AI Service to Cloud Run* → *Run workflow*
   - Opción B (primera vez): push cualquier cambio a `apps/ai-service/**`
     o al propio workflow

   > **Nota:** No hacer commits vacíos ni cambios de relleno solo para disparar un redeploy.
   > Usar siempre la Opción A (workflow_dispatch) para rotaciones futuras.

   - Verificar en GCP Console → Cloud Run → `sintia-ai-service` → nueva
     revisión → pestaña *Variables & Secrets* → confirmar que `WEBHOOK_SECRET`
     apunta a la versión nueva (no a la versión 1)

4. **Supabase Dashboard** → Database → Webhooks → `on-analysis-insert`
   → editar header `x-webhook-secret` → reemplazar con el nuevo valor
   ⚠️ Este campo NO se sincroniza automáticamente con nada — hay que actualizarlo manualmente.

5. **Test e2e**: seleccionar reunión con status `transcribed` → Analizar
   → verificar que el tab "Calidad" aparece en ~20s

6. **Destruir versión antigua** en GCP Secret Manager
   → versión inhabilitada → *Destroy version* → confirmar
   (Inhabilitada se puede re-habilitar; Destruida borra el valor criptográfico
   de forma permanente — necesario para cerrar el ciclo de seguridad correctamente)

### Tabla de riesgos — rotación de secrets

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| CI/CD falla (imagen Docker, auth WIF) | baja — no se toca código Python ni Dockerfile | Ver logs en Actions, no tocar webhook hasta deploy verde |
| Secret mal cargado en nueva revisión | muy baja — mismo workflow que funcionó antes | Verificación explícita en GCP Console antes del Paso 4 |
| Webhook actualizado antes de que Cloud Run tome el nuevo secret | evitado por orden del proceso | Secuencia estricta: redeploy → verificar → webhook |
| CI/CD falla durante la rotación | baja | Sistema sigue operativo: Cloud Run mantiene la revisión anterior con el secret pinado, y el header del webhook sigue coincidiendo. No tocar el webhook hasta resolver. Reintentar vía workflow_dispatch. |

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
│   │   ├── registry.py   # @register_handler("tipo") — punto de extensión
│   │   └── transcribe.py # transcribe_audio — chunked STT para audio >25 MB
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

**Handlers registrados actualmente:**
| Job type | Archivo | Trigger |
|----------|---------|---------|
| `analyze_meeting` | `agents/meeting/handler.py` | `agent-orchestrator` Deno cuando sector está en `PYTHON_AGENT_SECTORS` |
| `audit_analysis` | `agents/auditor/handler.py` | Supabase Webhook `on-analysis-insert` (INSERT meeting_analyses) |
| `transcribe_audio` | `handlers/transcribe.py` | `stt-transcribe` Deno cuando audio >25 MB |

**Auth:** `SERVICE_API_KEY` estático (bearer token) en todos los endpoints excepto `/health`. Supabase JWT se agrega cuando el servicio sea llamado externamente.

**Variables de entorno requeridas:** `DATABASE_URL` (asyncpg DSN), `OPENAI_API_KEY`, `SERVICE_API_KEY`. Ver `.env.example`.

**Gotchas conocidos (encontrados en e2e):**
- **asyncpg + `::jsonb`**: el operador de cast `::` de PostgreSQL choca con el parser de params nombrados de SQLAlchemy/asyncpg. Siempre usar `CAST(:param AS jsonb)` en queries `text()` — nunca `:param::jsonb`.
- **`OPENAI_API_KEY` no propagada**: `pydantic-settings` lee `.env` en el objeto `settings` pero NO setea `os.environ`. El SDK de OpenAI y `openai-agents` leen directamente de `os.environ`. Fix en `main.py`: `os.environ.setdefault("OPENAI_API_KEY", settings.openai_api_key)` al inicio del módulo.
- **Supabase Storage download (Python)**: usar `GET /storage/v1/object/{storage_path}` con headers `Authorization: Bearer {service_role_key}` + `apikey: {service_role_key}`. El endpoint `/object/authenticated/` es solo para user JWT, no service role. Ambos headers son necesarios (igual que hace supabase-js internamente).
- **Cloud Run CPU throttling**: sin `--no-cpu-throttling` en el deploy, Cloud Run **suspende el proceso completo** cuando no hay requests HTTP activos. El ffmpeg y cualquier work CPU-intensivo queda congelado indefinidamente. El flag es obligatorio para background workers.
- **`openai-agents` version constraint**: `pyproject.toml` dice `>=0.0.7` pero la versión instalada (en `uv.lock`) es `0.11.1`. Actualizar el constraint si se cambia la dependencia para reflejar la versión mínima real.
- **`meetings_status_check`**: el constraint original solo permitía 5 estados. `'analyzing'` y `'transcribing'` se usaban en código pero no estaban en el constraint — Deno los swallowaba silenciosamente; el handler Python lanzaba `CheckViolationError`. Migración `20260422000000` lo corrige. Cualquier status nuevo debe agregarse al constraint.
- **Wake-up ping en encoladores**: todo handler Deno que encola un job Python DEBE hacer `fetch(AI_SERVICE_URL/health)` fire-and-forget después de encolar. Sin esto, Cloud Run duerme indefinidamente con jobs en pending. Ver patrón en `stt-transcribe` y `agent-orchestrator` (Python routing block).

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
api/webhooks.py    # POST /webhooks/analysis-completed (trigger vía Supabase Webhook on-analysis-insert)
migrations/002_create_meeting_quality_reports.sql
```

**Tabla `meeting_quality_reports`:**
- FK a `meetings(id)` y `meeting_analyses(id)`
- `UNIQUE(analysis_id)` — un reporte por versión de análisis; upsert idempotente
- `confidence_score INT`, `report_json JSONB`, `model_used TEXT`

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
           INSERT INTO ai_jobs (job_type='audit_analysis')  ← fallback idempotente
               ↓ Supabase Webhook on-analysis-insert (trigger primario)
           Python worker (Cloud Run)
               ↓
           meeting_quality_reports
```

**Cambio en Deno** (`agent-orchestrator/index.ts`, función `handleAnalyze`):
Después de `update({ status: "analyzed" })`, inserta en `ai_jobs` via `supabase.upsert()` con `ignoreDuplicates: true`. Fallo no-fatal: error loggeado pero la respuesta de análisis no se ve afectada.

**Desacoplamiento via DB** (Strangler Fig): Deno escribe a `ai_jobs`, Python lee de `ai_jobs`. Sin HTTP directo entre servicios.

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

**Para agregar un nuevo dominio sin código:** insertar filas en `sectors` + `agent_profiles` (con o sin `activation_rules`) — el orchestrator lo toma automáticamente.

### Fase 6 — Deploy en Cloud Run (completa, validada e2e)

**Cloud Run URL:** `https://sintia-ai-service-hsimetvv7q-uc.a.run.app`

**Configuración del deploy:**
- `--no-cpu-throttling` — **crítico para background workers**
- `--timeout 3600` — necesario para transcripciones largas
- `--min-instances 0` — escala a 0; wake-up via ping desde `stt-transcribe` usando secret `AI_SERVICE_URL`

**Infraestructura GCP (sintia-production):**
- Artifact Registry: repositorio `sintia` en `us-central1`
- Workload Identity Federation: pool `github-actions` — keyless auth, sin JSON key de larga duración
- Service Account: `sintia-deploy@sintia-production.iam.gserviceaccount.com`
- Secret Manager: `sintia-database-url`, `sintia-openai-key`, `sintia-service-api-key`, `sintia-webhook-secret`, `sintia-supabase-url`, `sintia-supabase-service-role-key`

**GitHub Secrets:**
| Secret | Valor |
|--------|-------|
| `GCP_PROJECT_ID` | `sintia-production` |
| `GCP_REGION` | `us-central1` |
| `GCP_AR_REPO` | `sintia` |
| `GCP_SERVICE_ACCOUNT` | Email de la service account |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Resource name del provider WIF |
| `GCP_SA_KEY` | Obsoleto — reemplazado por WIF, puede eliminarse |

**Supabase Database Webhook (`on-analysis-insert`):**
- Table: `meeting_analyses`, Event: `INSERT`
- URL: `https://sintia-ai-service-hsimetvv7q-uc.a.run.app/webhooks/analysis-completed`
- HTTP Header: `x-webhook-secret: <WEBHOOK_SECRET>`

**Flujo completo:**
```
Frontend → agent-orchestrator (Deno) → INSERT meeting_analyses
                                              ↓ Supabase Webhook on-analysis-insert
                                        POST /webhooks/analysis-completed
                                              ↓
                                        ai_jobs (worker polling)
                                              ↓
                                        meeting_quality_reports
```

---

## Plan de migración: especialistas Deno → agentes Python reales (ítem 9)

Los "especialistas" en `agent-orchestrator` (Deno, ~640 líneas) son **llamadas LLM directas** — no son agentes reales. Cada especialista es una fila en `agent_profiles` con `system_prompt` + `output_schema_json`. Sin herramientas, sin razonamiento multi-paso, sin búsqueda de evidencia.

**Objetivo:** migrar a `Agent` real del OpenAI Agents SDK (Python), con herramientas propias por dominio. El coordinador orquesta especialistas como subagentes vía patrón **Agent-as-Tool**.

**Estructura objetivo en `apps/ai-service`:**
```
agents/
├── auditor/      # ya implementado — referencia para nuevos agentes
├── base/         # herramientas compartidas: search_transcript, get_context
└── sectors/
    ├── negocios/ # primer sector a migrar (CoordinatorAgent + specialists)
    ├── legal/
    └── salud/
```

**Estado final (sesión 8) — ítem 9 completo:**
- `agents/meeting/` implementado: `context.py`, `schemas.py`, `tools.py`, `agents.py`, `runner.py`, `repository.py`, `handler.py`
- `PYTHON_AGENT_SECTORS = new Set(["business","building_admin","ventas","legal","civil","metalurgia","salud"])` en `agent-orchestrator/index.ts`
- Migración `20260422100000_add_remaining_sectors.sql` aplicada: 7 sectores, 37 agent_profiles
- Sector "business" (Negocios): e2e validado en sesión 7 (análisis v16, quality report score 72)
- Sectores sesión 8: building_admin, ventas, legal, civil, metalurgia, salud — código + DB completo, e2e pendiente
- Output format (`CoordinatorOutput`): `summary`, `key_points`, `decisions`, `action_items`, `risks_alerts`, `suggested_responses`, `open_questions`, `confidence_notes`. Todos los campos con `evidence[]` citando transcript.
- `view_config_json` del sector "business" es la plantilla base — todos los sectores nuevos la comparten.

**Prompt lengths (referencia):** coordinadores 1189–1530 chars, specialists 825–1034 chars. Los specialists de sectores nuevos son ~40% más cortos que los de "business" — funcionales pero con menor profundidad analítica.

**Para agregar un sector nuevo:**
1. INSERT en `sectors`: `key`, `name`, `view_config_json` (usar el de "business" como base)
2. INSERT en `agent_profiles`: coordinator + specialists con `system_prompt` experto, `order_index`, `enabled=true`
3. Agregar `sector.key` a `PYTHON_AGENT_SECTORS` en `agent-orchestrator/index.ts`
4. `npx supabase functions deploy agent-orchestrator --project-ref bpzcogoixzxlzaaijdcr`

> El `AnalysisAuditor` (`agents/auditor/`) y el análisis de Negocios (`agents/meeting/`) son las referencias de implementación del patrón agente real en este proyecto.

---

## Deuda técnica

### MEDIA — resolver gradualmente

| ID | Archivo | Problema |
|----|---------|----------|
| M1 | `src/hooks/useMeetingBundle.ts` | Sin `AbortController` — race condition si el usuario cambia de meeting rápido. |
| M2 | `src/features/chat/ChatTab.tsx` | Fetch de streaming sin timeout — UI queda colgada si Cloud Run tarda. |
| M3 | `src/contexts/AuthContext.tsx` vs `OrgContext.tsx` | Error handling inconsistente: Auth lanza errores, Org los silencia. Debugging difícil. |
| M4 | `src/components/AudioRecorder.tsx` | `setInterval` puede quedar activo si el componente se desmonta durante grabación (memory leak). |
| M5 | `src/pages/MeetingDetail.tsx` | Sin `ErrorBoundary` en los tabs de análisis — crash de un tab pierde todo el contexto. |

### BAJA — mejoras de calidad

| ID | Archivo | Problema |
|----|---------|----------|
| B1 | `tsconfig.json` | `strictNullChecks: false`, `noImplicitAny: false` — habilitar gradualmente. |
| B2 | Todas las Edge Functions | `console.log()` sin niveles ni contexto estructurado. Noise en logs de producción. |
| B3 | `agents/auditor/agent.py`, `agent-orchestrator/index.ts` | Nombres de modelo (`gpt-4o`) hardcodeados — sin config central. |
| B4 | Todas las Edge Functions + Python service | Sin request ID (trace ID) para correlacionar logs Deno ↔ Python ↔ DB. |
| B5 | `apps/ai-service/pyproject.toml` | `openai-agents>=0.0.7` pero versión instalada es `0.11.1` — actualizar constraint al renovar la dependencia. |
