import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { batchesRouter, charactersRouter, scriptsRouter } from "./modules/content";
import { analyticsRouter, postsRouter } from "./modules/distribution";
import {
  assetsRouter,
  automationRouter,
  costsRouter,
  dashboardRouter,
  settingsRouter,
  teamRouter,
} from "./modules/ops";
import { premiumRouter, rendersRouter } from "./modules/production";

export const appRouter = router({
  // All APIs live under /api/ so the gateway routes them to the server.
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  team: teamRouter,
  dashboard: dashboardRouter,
  characters: charactersRouter,
  scripts: scriptsRouter,
  batches: batchesRouter,
  premium: premiumRouter,
  renders: rendersRouter,
  posts: postsRouter,
  analytics: analyticsRouter,
  assets: assetsRouter,
  costs: costsRouter,
  settings: settingsRouter,
  automation: automationRouter,
});

export type AppRouter = typeof appRouter;
