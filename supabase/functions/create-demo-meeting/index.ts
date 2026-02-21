import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, handleCorsPreflightOrForbidden } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const DEMO_TRANSCRIPTS: Record<string, { title: string; segments: { speaker: string; start: number; end: number; text: string }[] }> = {
  building_admin: {
    title: "Demo — Reunión de Comité de Administración",
    segments: [
      { speaker: "SPEAKER_0", start: 0, end: 15, text: "Buenos días a todos, vamos a revisar los temas pendientes del edificio. Primero, el informe de gastos comunes del mes." },
      { speaker: "SPEAKER_1", start: 16, end: 35, text: "Los gastos comunes subieron un 12% respecto al mes anterior. El principal factor fue la reparación de la bomba de agua del subterráneo, que costó 850 mil pesos." },
      { speaker: "SPEAKER_2", start: 36, end: 55, text: "¿Esa reparación estaba presupuestada? Porque no recuerdo que se haya aprobado en la asamblea anterior." },
      { speaker: "SPEAKER_1", start: 56, end: 75, text: "Fue una emergencia. La bomba falló un viernes en la noche y tuvimos que llamar a un técnico de urgencia. No había tiempo para convocar asamblea." },
      { speaker: "SPEAKER_0", start: 76, end: 95, text: "Entendido. Segundo tema: la propuesta de instalar cámaras de seguridad en los accesos. Tenemos dos cotizaciones." },
      { speaker: "SPEAKER_1", start: 96, end: 120, text: "La primera cotización es de SecurityPro por 2.4 millones con 8 cámaras HD y grabación en la nube por un año. La segunda es de VigilanciaTotal por 1.8 millones con 6 cámaras y grabación local." },
      { speaker: "SPEAKER_2", start: 121, end: 145, text: "Yo prefiero la opción con grabación en la nube. Si roban el DVR perdemos todo el registro. Además, 8 cámaras cubren mejor los puntos ciegos del estacionamiento." },
      { speaker: "SPEAKER_0", start: 146, end: 165, text: "Coincido. Propongo que votemos por SecurityPro. ¿Hay acuerdo? Bien, queda aprobado por unanimidad. María, por favor agenda la instalación." },
      { speaker: "SPEAKER_1", start: 166, end: 185, text: "Perfecto. Tercer tema: varios vecinos se han quejado del ruido en el departamento 801 los fines de semana. ¿Cómo procedemos?" },
      { speaker: "SPEAKER_0", start: 186, end: 210, text: "Enviemos primero una carta formal recordando el reglamento interno. Si persiste, aplicamos la multa según el artículo 15. ¿Algo más? Si no, cerramos la sesión. Próxima reunión el primer martes del mes." },
    ],
  },
  business: {
    title: "Demo — Reunión de Planificación Trimestral",
    segments: [
      { speaker: "SPEAKER_0", start: 0, end: 18, text: "Empecemos con la revisión del Q3. Las ventas cerraron en 45 millones, un 8% sobre el target. El equipo comercial tuvo un gran trimestre." },
      { speaker: "SPEAKER_1", start: 19, end: 40, text: "El canal digital creció un 23% gracias a la campaña de Google Ads que optimizamos en agosto. El costo de adquisición bajó de 12 mil a 8.500 pesos por cliente." },
      { speaker: "SPEAKER_2", start: 41, end: 60, text: "En producto, lanzamos la versión 2.1 con el módulo de reportes automatizados. La adopción ha sido del 67% en los primeros 30 días, sobre el benchmark de 50%." },
      { speaker: "SPEAKER_0", start: 61, end: 82, text: "Excelente. Para Q4, necesitamos definir tres prioridades. Mi propuesta: expansión a regiones, lanzamiento del plan Enterprise, y reducir churn un 15%." },
      { speaker: "SPEAKER_1", start: 83, end: 105, text: "Para regiones necesitamos al menos dos ejecutivos comerciales nuevos. El proceso de contratación toma 6-8 semanas, así que deberíamos publicar las ofertas esta semana." },
      { speaker: "SPEAKER_2", start: 106, end: 130, text: "El plan Enterprise requiere SSO y auditoría de logs. Estimamos 4 semanas de desarrollo. Podríamos tenerlo listo para mediados de noviembre si priorizamos." },
      { speaker: "SPEAKER_0", start: 131, end: 155, text: "Sobre el churn, los datos muestran que el 40% de las bajas son por falta de onboarding. Propongo implementar una secuencia de emails automatizada y sesiones de onboarding semanales." },
      { speaker: "SPEAKER_1", start: 156, end: 175, text: "Puedo armar la secuencia de emails esta semana. Necesito que producto me dé los flujos de activación clave para definir los triggers." },
      { speaker: "SPEAKER_2", start: 176, end: 195, text: "Te los envío mañana. También sugiero agregar un health score por cuenta para identificar riesgo de churn antes de que suceda." },
      { speaker: "SPEAKER_0", start: 196, end: 220, text: "Perfecto. Resumen de compromisos: RRHH publica ofertas esta semana, producto prioriza SSO, marketing arma secuencia de onboarding. Próxima revisión en dos semanas. ¡Vamos con todo!" },
    ],
  },
};

Deno.serve(async (req) => {
  const corsCheck = handleCorsPreflightOrForbidden(req);
  if (corsCheck) return corsCheck;
  const corsHeaders = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAuth = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { org_id, sector_key } = await req.json();
    if (!org_id || !sector_key) {
      return new Response(JSON.stringify({ error: "Faltan parámetros: org_id, sector_key" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: 3 demo creations per minute
    const rl = checkRateLimit(user.id, "demo", 3, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec, corsHeaders);

    const supabase = createClient(supabaseUrl, serviceKey);

    // Check org membership
    const { data: membership } = await supabase
      .from("org_members").select("id").eq("org_id", org_id).eq("user_id", user.id).single();
    if (!membership) {
      return new Response(JSON.stringify({ error: "Sin acceso" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get sector
    const { data: sector } = await supabase
      .from("sectors").select("id, key, name").eq("key", sector_key).single();
    if (!sector) {
      return new Response(JSON.stringify({ error: "Sector no encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check idempotency: if demo meeting exists for this org+sector, reuse it
    const demoTitle = DEMO_TRANSCRIPTS[sector_key]?.title || `Demo — Reunión ${sector.name}`;
    const { data: existing } = await supabase
      .from("meetings")
      .select("id, status")
      .eq("org_id", org_id)
      .eq("sector_id", sector.id)
      .or(`title.eq.${demoTitle},title.like.[TEST]%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      return new Response(
        JSON.stringify({ meeting_id: existing.id, reused: true, status: existing.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const demoData = DEMO_TRANSCRIPTS[sector_key];
    if (!demoData) {
      return new Response(JSON.stringify({ error: `No hay demo disponible para el sector '${sector_key}'` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create meeting
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .insert({
        org_id,
        sector_id: sector.id,
        title: demoTitle,
        notes: "Reunión de demostración generada automáticamente.",
        created_by: user.id,
        status: "transcribed",
        language: "es-CL",
      })
      .select("id")
      .single();

    if (meetingError || !meeting) {
      console.error("Demo meeting insert error:", meetingError);
      return new Response(JSON.stringify({ error: "Error al crear reunión demo" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create transcript
    const fullText = demoData.segments.map(s => s.text).join(" ");
    const { data: transcript, error: txError } = await supabase
      .from("meeting_transcripts")
      .insert({
        meeting_id: meeting.id,
        version: 1,
        provider: "demo",
        stt_model: "demo",
        transcript_text: fullText,
        diarization_json: { demo: true },
        created_by: user.id,
      })
      .select("id")
      .single();

    if (txError || !transcript) {
      console.error("Demo transcript error:", txError);
      return new Response(JSON.stringify({ error: "Error al crear transcripción demo" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert segments
    const segmentRows = demoData.segments.map((seg, idx) => ({
      meeting_id: meeting.id,
      transcript_id: transcript.id,
      segment_index: idx,
      speaker_label: seg.speaker,
      t_start_sec: seg.start,
      t_end_sec: seg.end,
      text: seg.text,
    }));

    await supabase.from("meeting_segments").insert(segmentRows);

    // Insert speaker names
    const speakerNames: Record<string, string> = {
      building_admin: JSON.stringify({ SPEAKER_0: "Presidente", SPEAKER_1: "Administradora María", SPEAKER_2: "Copropietario Juan" }),
      business: JSON.stringify({ SPEAKER_0: "CEO Andrés", SPEAKER_1: "Head Marketing Laura", SPEAKER_2: "CTO Diego" }),
    };

    const names = JSON.parse(speakerNames[sector_key] || "{}") as Record<string, string>;
    const speakerRows = Object.entries(names).map(([label, name]) => ({
      meeting_id: meeting.id,
      speaker_label: label,
      speaker_name: name,
    }));

    if (speakerRows.length > 0) {
      await supabase.from("meeting_speakers").insert(speakerRows);
    }

    return new Response(
      JSON.stringify({ meeting_id: meeting.id, reused: false, status: "transcribed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Demo error:", err);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
