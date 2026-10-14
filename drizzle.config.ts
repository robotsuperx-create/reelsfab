import { defineConfig } from "drizzle-kit";
import { getDatabaseUrl } from "./server/_core/database-url";

const connectionString = getDatabaseUrl();
if (!connectionString) {
  throw new Error("SUPABASE_DB_URL is required to run Drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/supabase",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
