import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

interface Organization {
  id: string;
  name: string;
  role: string;
}

export function useOrganization() {
  const { user } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setOrg(null);
      setLoading(false);
      return;
    }

    const fetchOrg = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("org_members")
        .select("org_id, role, organizations(id, name)")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      if (error || !data) {
        setOrg(null);
      } else {
        const orgData = data.organizations as unknown as { id: string; name: string };
        setOrg({
          id: orgData.id,
          name: orgData.name,
          role: data.role,
        });
      }
      setLoading(false);
    };

    fetchOrg();
  }, [user]);

  const updateOrgName = async (name: string) => {
    if (!org) return;
    const { error } = await supabase
      .from("organizations")
      .update({ name })
      .eq("id", org.id);
    if (error) throw error;
    setOrg({ ...org, name });
  };

  return { org, loading, updateOrgName };
}
