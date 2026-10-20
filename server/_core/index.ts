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
import { describeDbError, ensureSeed } from "../db";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use("/api/trpc", rateLimit({ windowMs: 60_000, max: 600 }));
  app.use("/api/upload", rateLimit({ windowMs: 60_000, max: 60 }));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
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
      void ensureSeed().catch(e => console.warn("[database]", describeDbError(e)));
    }
    startAutopilot(); });
}

startServer().catch(error => { console.error(error); process.exit(1); });
