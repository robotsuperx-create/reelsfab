import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { CINEMA_FORMATS, CINEMA_MUSIC } from "../../shared/cinema";
import { memberProcedure } from "../procedures";
import { router } from "../_core/trpc";
import { agentEngines, ask } from "../services/code-agent";
import { getCinemaJob, listCinemaJobs, startCinemaJob } from "../services/cinema";
import { writeCinemaScript } from "../services/cinema/director";

export const cinemaRouter = router({
  /** Starts a narrated cinema reel: the director writes it, then voice, pictures, recording and mix run in the background. */
  start: memberProcedure
    .input(z.object({
      idea: z.string().trim().min(8, "اكتب الفكرة بجملة على الأقل").max(12000),
      seconds: z.number().int().min(15).max(120).default(30),
      format: z.enum(CINEMA_FORMATS).default("9:16"),
      voice: z.string().max(60).optional(),
      music: z.enum(CINEMA_MUSIC).optional(),
      engine: z.enum(["claude-code", "api"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const e = await agentEngines();
      const engine = input.engine === "api" && e.api ? "api" : input.engine === "claude-code" && e.claudeCode ? "claude-code" : e.claudeCode ? "claude-code" : e.api ? "api" : null;
      if (!engine) throw new TRPCError({ code: "BAD_REQUEST", message: "لا عقل للمخرج: سجّل الدخول في Claude Code على هذا الجهاز أو أضف مفتاح Claude في مركز التكاملات" });
      const lang = /[؀-ۿ]/.test(input.idea) ? "ar" : "en";
      return startCinemaJob({
        idea: input.idea,
        userId: ctx.user?.id ?? null,
        options: { format: input.format, seconds: input.seconds, voice: input.voice, music: input.music, engine },
        write: job => writeCinemaScript({
          idea: input.idea, seconds: input.seconds, format: input.format, lang,
          ask: (system, prompt, what) => ask(engine, system, prompt, { id: 0, userId: ctx.user?.id ?? null, what, refType: "cinema" }),
          log: async line => { job.log.push(line); },
        }),
      });
    }),
  get: memberProcedure.input(z.object({ id: z.string().max(40) })).query(async ({ input }) => {
    const j = await getCinemaJob(input.id);
    if (!j) throw new TRPCError({ code: "NOT_FOUND", message: "غير موجود" });
    return j;
  }),
  list: memberProcedure.query(() => listCinemaJobs(30)),
});
