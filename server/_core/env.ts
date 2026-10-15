// Values are read at use time. SESSION_SECRET / APP_ID fall back to the legacy MANUS_* names so existing deployments keep working.
export const ENV = {
  get appId() { return process.env.APP_ID ?? process.env.MANUS_PROJECT_ID ?? "reelsfab"; },
  get cookieSecret() { return process.env.SESSION_SECRET ?? process.env.MANUS_JWT_SECRET ?? ""; },
  get databaseUrl() { return process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? ""; },
  get supabaseUrl() { return process.env.SUPABASE_URL ?? ""; },
  get supabaseAnonKey() { return process.env.SUPABASE_ANON_KEY ?? ""; },
  get supabaseServiceRoleKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""; },
  get supabaseStorageBucket() { return process.env.SUPABASE_STORAGE_BUCKET ?? "reelsfab"; },
  get ownerOpenId() { return process.env.OWNER_OPEN_ID ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
};
