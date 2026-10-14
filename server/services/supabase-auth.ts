import { createClient } from "@supabase/supabase-js";
import { ENV } from "../_core/env";

export type SupabaseIdentity = {
  id: string;
  email: string | null;
  name: string | null;
};

/** Verifies a Supabase access token without depending on the Manus OAuth service. */
export async function getSupabaseIdentity(accessToken: string): Promise<SupabaseIdentity | null> {
  const url = ENV.supabaseUrl;
  const key = ENV.supabaseAnonKey || ENV.supabaseServiceRoleKey;
  if (!url || !key || !accessToken) return null;

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return null;

  const metadata = data.user.user_metadata ?? {};
  const name =
    (typeof metadata.full_name === "string" && metadata.full_name) ||
    (typeof metadata.name === "string" && metadata.name) ||
    data.user.email?.split("@")[0] ||
    null;

  return { id: data.user.id, email: data.user.email ?? null, name };
}
