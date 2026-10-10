import { z } from "zod";
import { router } from "../_core/trpc";
import { memberProcedure } from "../procedures";
import { generateCharacterFromDescription } from "../services/character-generator";

export const characterGeneratorRouter = router({
  generate: memberProcedure.input(z.object({ description: z.string().min(20).max(5000), provider: z.enum(["openai", "anthropic", "gemini"]), model: z.string().min(1).max(120) })).mutation(({ input }) => generateCharacterFromDescription(input)),
});
