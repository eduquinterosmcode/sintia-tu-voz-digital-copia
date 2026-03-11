-- RBAC básico: tighten policies so only owners can mutate org-level settings
-- and add org_members management policies.
--
-- Role model: 'owner' (full control) | 'member' (read + create meetings)
-- The DB already has org_members.role and user_is_org_owner() from the initial migration.

-- ── organizations ─────────────────────────────────────────────────────────────
-- Only owners can rename the org.

DROP POLICY IF EXISTS "orgs_update" ON public.organizations;
CREATE POLICY "orgs_update"
  ON public.organizations FOR UPDATE TO authenticated
  USING (public.user_is_org_owner(id))
  WITH CHECK (public.user_is_org_owner(id));

-- ── org_provider_settings ─────────────────────────────────────────────────────
-- Any org member can read provider settings (needed for analysis/STT calls).
-- Only owners can change models, temperature, budgets.

DROP POLICY IF EXISTS "settings_update" ON public.org_provider_settings;
CREATE POLICY "settings_update"
  ON public.org_provider_settings FOR UPDATE TO authenticated
  USING (public.user_is_org_owner(org_id))
  WITH CHECK (public.user_is_org_owner(org_id));

DROP POLICY IF EXISTS "settings_delete" ON public.org_provider_settings;
CREATE POLICY "settings_delete"
  ON public.org_provider_settings FOR DELETE TO authenticated
  USING (public.user_is_org_owner(org_id));

-- ── org_members ───────────────────────────────────────────────────────────────
-- Members can see who's in their org.
-- Only owners can remove members or change roles.
-- Guard: an owner cannot remove themselves (would leave org ownerless).

DROP POLICY IF EXISTS "org_members_select" ON public.org_members;
CREATE POLICY "org_members_select"
  ON public.org_members FOR SELECT TO authenticated
  USING (public.user_has_org_access(org_id));

DROP POLICY IF EXISTS "org_members_delete" ON public.org_members;
CREATE POLICY "org_members_delete"
  ON public.org_members FOR DELETE TO authenticated
  USING (
    public.user_is_org_owner(org_id)
    AND user_id <> auth.uid()   -- owners cannot remove themselves
  );

DROP POLICY IF EXISTS "org_members_update" ON public.org_members;
CREATE POLICY "org_members_update"
  ON public.org_members FOR UPDATE TO authenticated
  USING (public.user_is_org_owner(org_id))
  WITH CHECK (
    public.user_is_org_owner(org_id)
    AND role IN ('owner', 'member')  -- keep within valid roles
  );
