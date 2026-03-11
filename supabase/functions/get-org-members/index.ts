import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, handleCorsPreflightOrForbidden } from "../_shared/cors.ts";

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

    // Verify the calling user
    const supabaseAuth = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Get the user's org membership (verifies they belong to an org)
    const { data: membership } = await supabase
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!membership) {
      return new Response(JSON.stringify({ error: "Sin organización" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all members of the org with their emails via SQL join on auth.users
    const { data: members, error: membersError } = await supabase
      .from("org_members")
      .select("id, user_id, role, created_at")
      .eq("org_id", membership.org_id)
      .order("role")
      .order("created_at");

    if (membersError || !members) {
      throw new Error(membersError?.message || "Error al cargar miembros");
    }

    // Enrich with emails using admin API (service role required)
    const enriched = await Promise.all(
      members.map(async (m) => {
        const { data: { user: memberUser } } = await supabase.auth.admin.getUserById(m.user_id);
        return {
          id: m.id,
          user_id: m.user_id,
          email: memberUser?.email ?? "—",
          role: m.role,
          created_at: m.created_at,
          is_self: m.user_id === user.id,
        };
      })
    );

    return new Response(
      JSON.stringify({ members: enriched, caller_role: membership.role }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-org-members error:", err);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
