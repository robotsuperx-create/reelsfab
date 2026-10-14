/**
 * Returns a PostgreSQL URL that works from IPv4-only runtimes.
 * Supabase's direct db hostname is IPv6-only for some projects; when that
 * form is supplied, transparently derive the session-pooler URL. A supplied
 * pooler URL is left unchanged.
 */
export function getDatabaseUrl(raw = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const hostParts = url.hostname.split(".");
    const isSupabaseDirect = hostParts.length >= 3 && hostParts[0] === "db" && hostParts[2] === "supabase";
    if (!isSupabaseDirect) return raw;

    const projectRef = hostParts[1];
    const region = process.env.SUPABASE_DB_POOLER_REGION || "eu-west-1";
    const cluster = process.env.SUPABASE_DB_POOLER_CLUSTER || "aws-0";
    const port = process.env.SUPABASE_DB_POOLER_PORT || "5432";
    url.hostname = `${cluster}-${region}.pooler.supabase.com`;
    url.username = `postgres.${projectRef}`;
    url.port = port;
    url.searchParams.set("sslmode", "require");
    return url.toString();
  } catch {
    return raw;
  }
}
