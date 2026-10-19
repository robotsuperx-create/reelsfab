import { getIntegrationConfig } from "./integration-vault";

/**
 * Owner notifications over Telegram, configured in the Integrations page (provider "telegram": botToken + chatId).
 * Without it the message is only logged. Never throws: notifications must not break the pipeline.
 */
export async function notifyOwner(msg: { title: string; content: string }): Promise<boolean> {
  const text = `${msg.title}\n\n${msg.content}`.slice(0, 3900);
  let token = "";
  let chat = "";
  try {
    const c = await getIntegrationConfig("telegram");
    token = c.botToken || c.apiKey || "";
    chat = c.chatId || "";
  } catch {
    /* vault unavailable */
  }
  if (!token || !chat) {
    console.log(`[notify] ${msg.title} — ${msg.content.slice(0, 200)}`);
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.warn("[notify] telegram failed", res.status);
    return res.ok;
  } catch (e) {
    console.warn("[notify] telegram error", e instanceof Error ? e.message : e);
    return false;
  }
}
