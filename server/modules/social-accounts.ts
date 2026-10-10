import { z } from "zod";
import { router } from "../_core/trpc";
import { memberProcedure } from "../procedures";
import { deleteSocialAccount, listSocialAccounts, saveSocialToken } from "../services/social-accounts";
export const socialAccountsRouter = router({
  list: memberProcedure.input(z.object({ characterId: z.number().optional() }).optional()).query(({ input }) => listSocialAccounts(input?.characterId)),
  connectManual: memberProcedure.input(z.object({ id: z.number().optional(), characterId: z.number(), platform: z.enum(["instagram", "tiktok", "youtube"]), handle: z.string().max(160).nullable(), platformUserId: z.string().max(160).nullable(), accessToken: z.string().min(10), refreshToken: z.string().nullable(), expiresAt: z.date().nullable(), timezone: z.string().max(80) })).mutation(({ input, ctx }) => saveSocialToken({ ...input, userId: ctx.user.id })),
  disconnect: memberProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => deleteSocialAccount(input.id)),
});
