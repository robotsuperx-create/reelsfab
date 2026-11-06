import { z } from "zod";
import { router } from "../_core/trpc";
import { memberProcedure } from "../procedures";
import { generateElevenLabsSpeech, generateImage } from "../services/media-generators";

export const mediaGenerationRouter = router({
  elevenlabsSpeech: memberProcedure.input(z.object({ text: z.string().min(1).max(5000), voiceId: z.string().min(1).max(120), modelId: z.string().max(120).optional() })).mutation(({ input }) => generateElevenLabsSpeech(input)),
  image: memberProcedure.input(z.object({ provider: z.enum(["openai", "gemini", "fal"]), prompt: z.string().min(1).max(4000), size: z.string().max(30).optional(), tier: z.enum(["draft", "standard", "premium"]).optional() })).mutation(({ input, ctx }) => generateImage({ ...input, userId: ctx.user.id })),
});
