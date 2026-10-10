import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "./_core/trpc";
import { ensureSeed } from "./db";

/** Approved team members (member or admin). Pending users ("user") are blocked. */
export const memberProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "member" && ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "حسابك بانتظار موافقة مدير الفريق." });
  }
  await ensureSeed();
  return next({ ctx });
});

export const teamAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "هذا الإجراء للمدير فقط." });
  }
  await ensureSeed();
  return next({ ctx });
});
