/**
 * The project's root URL. The dashboard also shows ".../rest/v1" (the REST endpoint); pasted as SUPABASE_URL it would
 * send storage and auth calls to PostgREST ("PGRST125 Invalid path"), so any path is dropped here.
 */
export function supabaseOrigin(raw?: string | null) {
  const v = (raw ?? "").trim();
  if (!v) return "";
  try {
    return new URL(v).origin;
  } catch {
    return v.replace(/\/(rest|auth|storage)\/v1.*$/i, "").replace(/\/+$/, "");
  }
}

// Values are read at use time.
export const ENV = {
  get appId() { return process.env.APP_ID ?? "reelsfab"; },
  get cookieSecret() { return process.env.SESSION_SECRET ?? ""; },
  get databaseUrl() { return process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? ""; },
  get supabaseUrl() { return supabaseOrigin(process.env.SUPABASE_URL); },
  get supabaseAnonKey() { return process.env.SUPABASE_ANON_KEY ?? ""; },
  get supabaseServiceRoleKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""; },
  get supabaseStorageBucket() { return process.env.SUPABASE_STORAGE_BUCKET ?? "reelsfab"; },
  get ownerOpenId() { return process.env.OWNER_OPEN_ID ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
};
