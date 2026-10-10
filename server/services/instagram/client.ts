export type InstagramClientOptions = { igUserId: string; accessToken: string; apiVersion?: string; fetchImpl?: typeof fetch };
export type InstagramContainer = { id: string };
export type InstagramPublishResult = { id: string };

export class InstagramApiError extends Error {
  constructor(public status: number, message: string, public raw?: unknown) { super(message); this.name = "InstagramApiError"; }
}

export class InstagramClient {
  private readonly base: string;
  private readonly fetcher: typeof fetch;
  constructor(private options: InstagramClientOptions) {
    this.base = `https://graph.instagram.com/${options.apiVersion ?? "v26.0"}`;
    this.fetcher = options.fetchImpl ?? fetch;
  }
  private async call<T>(path: string, init: RequestInit = {}, tries = 2): Promise<T> {
    const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${this.options.accessToken}`); headers.set("Content-Type", "application/json");
    for (let attempt = 0; attempt < tries; attempt++) {
      const response = await this.fetcher(`${this.base}/${this.options.igUserId}${path}`, { ...init, headers, signal: AbortSignal.timeout(45000) });
      const raw = await response.json().catch(() => ({}));
      if (response.ok) return raw as T;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === tries - 1) throw new InstagramApiError(response.status, `Instagram API error: ${raw?.error?.message ?? response.statusText}`, raw);
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
    throw new Error("Instagram request failed");
  }
  async createReelContainer(input: { videoUrl: string; caption?: string; shareToFeed?: boolean }): Promise<InstagramContainer> {
    if (!/^https:\/\//i.test(input.videoUrl)) throw new Error("Instagram requires a publicly accessible HTTPS video URL");
    return this.call<InstagramContainer>("/media", { method: "POST", body: JSON.stringify({ media_type: "REELS", video_url: input.videoUrl, caption: input.caption ?? "", share_to_feed: input.shareToFeed ?? true }) });
  }
  async getContainerStatus(containerId: string): Promise<{ id: string; status_code?: string; status?: string }> {
    const response = await this.fetcher(`${this.base}/${encodeURIComponent(containerId)}?fields=status_code,status`, { headers: { Authorization: `Bearer ${this.options.accessToken}` }, signal: AbortSignal.timeout(45000) });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) throw new InstagramApiError(response.status, `Instagram API error: ${raw?.error?.message ?? response.statusText}`, raw);
    return raw as { id: string; status_code?: string; status?: string };
  }
  async waitForContainer(containerId: string, opts: { maxPolls?: number; intervalMs?: number } = {}) {
    const max = opts.maxPolls ?? 20; const interval = opts.intervalMs ?? 3000;
    for (let i = 0; i < max; i++) {
      const status = await this.getContainerStatus(containerId);
      if (["FINISHED", "PUBLISHED"].includes(status.status_code ?? "")) return status;
      if (["ERROR", "EXPIRED"].includes(status.status_code ?? "")) throw new Error(`Instagram container ${status.status_code}`);
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error("Instagram container processing timed out");
  }
  async publishContainer(containerId: string): Promise<InstagramPublishResult> {
    return this.call<InstagramPublishResult>("/media_publish", { method: "POST", body: JSON.stringify({ creation_id: containerId }) });
  }
  async publishReel(input: { videoUrl: string; caption?: string; shareToFeed?: boolean }) {
    const container = await this.createReelContainer(input);
    await this.waitForContainer(container.id);
    return this.publishContainer(container.id);
  }
  async publishingLimit() { return this.call<{ data?: Array<Record<string, unknown>> }>("/content_publishing_limit"); }
}
