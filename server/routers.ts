import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { LOCAL_OPEN_ID, setLocalSessionCookie, verifyLocalCredentials } from "./_core/localAuth";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
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
import { getUserByOpenId, upsertUser } from "./db";
import { z } from "zod";
import { characterGeneratorRouter } from "./modules/character-generator";
import { socialAccountsRouter } from "./modules/social-accounts";
import { integrationsRouter } from "./modules/integrations";

export const appRouter = router({
  // All APIs live under /api/ so the gateway routes them to the server.
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    localLogin: publicProcedure
      .input(z.object({ identifier: z.string().min(1).max(160), password: z.string().min(1).max(512) }))
      .mutation(async ({ input, ctx }) => {
        if (!(await verifyLocalCredentials(ctx.req, input.identifier, input.password))) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "معرّف الدخول أو كلمة المرور غير صحيحة" });
        }

        await upsertUser({
          openId: LOCAL_OPEN_ID,
          name: "مدير المصنع",
          email: null,
          loginMethod: "local",
          role: "admin",
        });
        const sessionToken = await sdk.createSessionToken(LOCAL_OPEN_ID, { name: "مدير المصنع" });
        setLocalSessionCookie(ctx.req, ctx.res, sessionToken);
        return getUserByOpenId(LOCAL_OPEN_ID);
      }),
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
  characterGenerator: characterGeneratorRouter,
  socialAccounts: socialAccountsRouter,
  integrations: integrationsRouter,
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
