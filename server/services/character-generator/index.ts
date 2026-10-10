import { invokeProvider, parseJson, type ProviderName } from "../ai-providers";

export type GeneratedCharacter = {
  name: string; nameAr: string; age: string; origin: string; niche: string;
  appearancePrompt: string; wardrobe: string; voiceDescription: string; style: string;
  catchphrase: string; contentTemplates: string[]; product: string; rules: string;
  loraKeyword: string; ttsVoice: string; ttsSpeed: number;
  colors: { primary: string; accent: string; text: string }; dailyQuota: number;
};
const schema = { type: "object", additionalProperties: false, properties: {
  name:{type:"string"}, nameAr:{type:"string"}, age:{type:"string"}, origin:{type:"string"}, niche:{type:"string"}, appearancePrompt:{type:"string"}, wardrobe:{type:"string"}, voiceDescription:{type:"string"}, style:{type:"string"}, catchphrase:{type:"string"}, contentTemplates:{type:"array",items:{type:"string"}}, product:{type:"string"}, rules:{type:"string"}, loraKeyword:{type:"string"}, ttsVoice:{type:"string"}, ttsSpeed:{type:"number"}, colors:{type:"object",additionalProperties:false,properties:{primary:{type:"string"},accent:{type:"string"},text:{type:"string"}},required:["primary","accent","text"]}, dailyQuota:{type:"number"}
}, required:["name","nameAr","age","origin","niche","appearancePrompt","wardrobe","voiceDescription","style","catchphrase","contentTemplates","product","rules","loraKeyword","ttsVoice","ttsSpeed","colors","dailyQuota"] } as Record<string, unknown>;

export function buildCharacterPrompt(description: string) {
  return `Create a complete AI influencer character bible from this description:\n${description}\n\nThe content language is English and each reel is 15 seconds. Keep claims honest: no guaranteed income, medical results, investment advice, fake statistics, or impersonation. Choose one Kokoro voice id from af_heart, af_bella, af_sarah, am_michael, am_onyx, bm_george, bm_lewis, bf_emma, bf_isabella. Return only the requested JSON.`;
}

export async function generateCharacterFromDescription(input: { description: string; provider: Exclude<ProviderName, "manus">; model: string; maxTokens?: number }) {
  if (input.description.trim().length < 20) throw new Error("Character description must be at least 20 characters");
  const result = await invokeProvider({ provider: input.provider, model: input.model, prompt: buildCharacterPrompt(input.description), jsonSchema: schema, maxTokens: input.maxTokens ?? 1800 });
  const character = parseJson<GeneratedCharacter>(result.text);
  if (!character.name || !character.niche || !character.appearancePrompt || character.contentTemplates.length < 3) throw new Error("Generated character is incomplete");
  character.ttsSpeed = Math.max(60, Math.min(150, Number(character.ttsSpeed) || 100));
  character.dailyQuota = Math.max(0, Math.min(50, Number(character.dailyQuota) || 3));
  return { character, provider: result.provider, model: result.model, usage: result.usage };
}
