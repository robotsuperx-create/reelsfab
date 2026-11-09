import "dotenv/config";
import express from "express";
import path from "node:path";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerMediaRoutes } from "../routes/media";
import { registerMetaRoutes } from "../routes/meta";
import { rateLimit, securityHeaders } from "./security";
import { startAutopilot } from "../worker/autopilot";
import { registerSetupRoutes, setupComplete } from "./setup";
import { sql } from "drizzle-orm";
import { describeDbError, ensureSeed, getDb, looksLikePausedProject } from "../db";
import { ensureSchemaUpgrades } from "../db-upgrades";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Long episode scripts can take several minutes; Node's default 5-minute request timeout would cut them off.
  server.requestTimeout = 16 * 60_000;
  // Configure body parser with larger size limit for file uploads
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use("/api/trpc", rateLimit({ windowMs: 60_000, max: 600 }));
  app.use("/api/upload", rateLimit({ windowMs: 60_000, max: 60 }));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));
  app.get("/api/health", async (_req, res) => res.set("Cache-Control", "no-store").json({ status: "ok", ...(await databaseHealth()) }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  // Character portraits for the sign-in screen (public persona images, nothing private).
  app.use("/brand/characters", (req, res, next) => (/^\/[a-z]+\.jpg$/.test(req.path) ? next() : res.status(404).end()), express.static(path.join(process.cwd(), "assets", "characters"), { maxAge: "7d", index: false, extensions: ["jpg"] }));
  registerSetupRoutes(app);
  registerMediaRoutes(app);
  registerMetaRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => { console.log(`Server listening on port ${port}`);
    if (!setupComplete()) {
      console.log(`[setup] Configuration incomplete. Open http://localhost:${port}/setup on this computer to finish it.`);
    } else {
      void bootstrapDatabase();
    }
    startAutopilot(); });
}

/** Cached (15s) database probe for /api/health, so the UI can say "Supabase is paused" instead of failing quietly. */
let healthCache: { at: number; value: { db: "ok" | "down" | "unconfigured"; dbHint?: string; dbPaused?: boolean } } | null = null;
async function databaseHealth() {
  if (healthCache && Date.now() - healthCache.at < 15_000) return healthCache.value;
  let value: NonNullable<typeof healthCache>["value"];
  if (!setupComplete()) value = { db: "unconfigured" };
  else {
    try {
      const db = await getDb();
      if (!db) value = { db: "unconfigured" };
      else {
        await Promise.race([db.execute(sql`select 1`), new Promise((_, reject) => setTimeout(() => reject(new Error("connect timeout")), 6_000))]);
        value = { db: "ok" };
      }
    } catch (e) {
      value = { db: "down", dbHint: describeDbError(e), dbPaused: looksLikePausedProject(e) };
    }
  }
  healthCache = { at: Date.now(), value };
  return value;
}

/**
 * Schema upgrade + seed, retried with backoff until the database answers: a paused Supabase project that the
 * owner restores while the app is running gets its tables and channels without a restart.
 */
async function bootstrapDatabase() {
  const delays = [15_000, 30_000, 60_000, 120_000, 300_000];
  for (let attempt = 0; ; attempt++) {
    try {
      await ensureSchemaUpgrades();
      await ensureSeed();
      if (attempt) console.log("[database] connected — schema and seed are in place");
      return;
    } catch (e) {
      const wait = delays[Math.min(attempt, delays.length - 1)];
      console.warn(`[database] ${describeDbError(e)}\n  ↳ retrying in ${Math.round(wait / 1000)}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

startServer().catch(error => { console.error(error); process.exit(1); });
