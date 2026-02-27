import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

interface Organization {
  id: string;
  name: string;
  role: string;
}

interface OrgContextValue {
  org: Organization | null;
  loading: boolean;
  updateOrgName: (name: string) => Promise<void>;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
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
        setOrg({ id: orgData.id, name: orgData.name, role: data.role });
      }
      setLoading(false);
    };

    fetchOrg();
  }, [user]);

  const updateOrgName = useCallback(async (name: string) => {
    if (!org) return;
    const { error } = await supabase.from("organizations").update({ name }).eq("id", org.id);
    if (error) throw error;
    setOrg((prev) => prev ? { ...prev, name } : null);
  }, [org]);

  return (
    <OrgContext.Provider value={{ org, loading, updateOrgName }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrganization(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrganization must be used within OrgProvider");
  return ctx;
}
