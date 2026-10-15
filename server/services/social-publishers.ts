import { getIntegrationConfig } from "./integration-vault";
import { decryptSecret } from "./social-accounts";
import { storageGetSignedUrl } from "../storage";
import type { SocialAccount } from "../../drizzle/schema";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function publishTikTok(input: { account: SocialAccount; storageKey?: string | null; videoUrl?: string | null; title: string }) {
  if (!input.account.encryptedAccessToken) throw new Error("TikTok account token is missing");
  const token = decryptSecret(input.account.encryptedAccessToken);
  const sourceUrl = input.storageKey ? await storageGetSignedUrl(input.storageKey) : input.videoUrl;
  if (!sourceUrl) throw new Error("TikTok video URL is missing");
  const video = await fetch(sourceUrl); if (!video.ok) throw new Error(`TikTok source download failed (${video.status})`);
  const buffer = Buffer.from(await video.arrayBuffer());
  const creator = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" }, body: "{}" });
  const creatorBody = await creator.json().catch(() => ({}));
  if (!creator.ok) throw new Error(`TikTok creator info ${creator.status}: ${JSON.stringify(creatorBody).slice(0, 400)}`);
  const privacy = creatorBody?.data?.privacy_level_options?.[0] ?? "PUBLIC_TO_EVERYONE";
  const init = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify({ post_info: { title: input.title.slice(0, 2200), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 }, source_info: { source: "FILE_UPLOAD", video_size: buffer.length, chunk_size: buffer.length, total_chunk_count: 1 } }) });
  const initBody = await init.json().catch(() => ({}));
  if (!init.ok) throw new Error(`TikTok init ${init.status}: ${JSON.stringify(initBody).slice(0, 400)}`);
  const uploadUrl = initBody?.data?.upload_url; const publishId = initBody?.data?.publish_id;
  if (!uploadUrl || !publishId) throw new Error("TikTok returned no upload URL");
  const uploaded = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes 0-${buffer.length - 1}/${buffer.length}`, "Content-Type": "video/mp4", "Content-Length": String(buffer.length) }, body: buffer });
  if (!uploaded.ok) throw new Error(`TikTok upload ${uploaded.status}`);
  for (let i = 0; i < 20; i++) {
    const status = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ publish_id: publishId }) });
    const body = await status.json().catch(() => ({}));
    const state = body?.data?.status;
    if (state === "PUBLISH_COMPLETE") return { id: publishId, url: body?.data?.publicaly_available_post_id?.[0] ?? null };
    if (["FAILED", "PUBLISH_FAILED"].includes(state)) throw new Error(`TikTok publish failed: ${JSON.stringify(body).slice(0, 400)}`);
    await sleep(3000);
  }
  throw new Error("TikTok publish timed out; the upload may still be processing");
}

export async function youtubeAccessToken(account: SocialAccount) {
  if (!account.encryptedAccessToken) throw new Error("YouTube access token is missing");
  const access = decryptSecret(account.encryptedAccessToken);
  if (!account.tokenExpiresAt || account.tokenExpiresAt.getTime() > Date.now() + 60_000) return access;
  if (!account.encryptedRefreshToken) throw new Error("YouTube token expired and refresh token is missing");
  const config = await getIntegrationConfig("youtube");
  const clientId = config.clientId || config.apiKey; const clientSecret = config.clientSecret || config.apiSecret;
  if (!clientId || !clientSecret) throw new Error("YouTube integration needs clientId and clientSecret for token refresh");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decryptSecret(account.encryptedRefreshToken), grant_type: "refresh_token" }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`YouTube token refresh ${response.status}`);
  return body.access_token as string;
}

export async function publishYouTube(input: { account: SocialAccount; storageKey?: string | null; videoUrl?: string | null; title: string; description?: string; tags?: string[] }) {
  const token = await youtubeAccessToken(input.account);
  const sourceUrl = input.storageKey ? await storageGetSignedUrl(input.storageKey) : input.videoUrl;
  if (!sourceUrl) throw new Error("YouTube video URL is missing");
  const video = await fetch(sourceUrl); if (!video.ok) throw new Error(`YouTube source download failed (${video.status})`);
  const buffer = Buffer.from(await video.arrayBuffer());
  const metadata = { snippet: { title: input.title.slice(0, 100), description: (input.description ?? "").slice(0, 5000), tags: (input.tags ?? []).slice(0, 30), categoryId: "22" }, status: { privacyStatus: "public", selfDeclaredMadeForKids: false } };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(buffer.length) }, body: JSON.stringify(metadata) });
  if (!init.ok) throw new Error(`YouTube upload init ${init.status}: ${(await init.text()).slice(0, 400)}`);
  const location = init.headers.get("location"); if (!location) throw new Error("YouTube returned no resumable upload URL");
  const uploaded = await fetch(location, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(buffer.length) }, body: buffer });
  const body = await uploaded.json().catch(() => ({}));
  if (!uploaded.ok || !body.id) throw new Error(`YouTube upload ${uploaded.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return { id: body.id as string, url: `https://www.youtube.com/shorts/${body.id}` };
}
