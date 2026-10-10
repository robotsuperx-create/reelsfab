# External API notes

## Instagram / Meta
- Official source: https://developers.facebook.com/documentation/instagram-platform/content-publishing
- Updated: 2026-06-30.
- Content Publishing API supports images, videos, Reels and carousels for Instagram professional accounts.
- Media must be hosted on a publicly accessible server at publish time.
- Professional account requirements and permissions vary by login flow; Instagram Login uses `instagram_business_basic` and `instagram_business_content_publish`, while Facebook Login uses `instagram_basic`, `instagram_content_publish`, and `pages_read_engagement`.
- Core flow: create `/<IG_ID>/media` container, poll container status, then call `/<IG_ID>/media_publish`.
- API-published account limit documented as 100 posts in a rolling 24-hour period; the app should enforce its own guard.

## Claude
- Official source: https://platform.claude.com/docs/en/api/overview
- Direct API base: https://api.anthropic.com
- Messages API: `POST /v1/messages`; API keys are server-side credentials.
- Message Batches API is available for asynchronous high-volume workloads.

## Gemini
- Official source: https://ai.google.dev/api/generate-content
- `models.generateContent` accepts multimodal content, tools, JSON mode and safety settings; endpoint uses the Google Generative Language API.

## OpenAI
- Official source: https://developers.openai.com/api/reference/overview/
- Responses API is the recommended surface for direct text/image/tool requests; bearer API keys must remain server-side.
- Production integrations should log request IDs and handle rate limits/errors.
