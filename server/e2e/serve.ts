/**
 * Local test server: the real app (built client + API + autopilot) with every external service faked.
 *   DATABASE_URL=postgres://postgres@127.0.0.1:54329/reelsfab_ui pnpm build && pnpm tsx server/e2e/serve.ts
 */
import { FAKE_ENV, installFakes } from "./fakes";

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL must be a local throwaway database.");
  process.exit(1);
}
for (const [k, v] of Object.entries(FAKE_ENV)) process.env[k] ??= v;
process.env.NODE_ENV ??= "production";
process.env.E2E_STORAGE_DIR ??= "/var/tmp/reelsfab-e2e-storage";
process.env.E2E_SAMPLE_MP4 ??= "/var/tmp/sample-premium.mp4";
process.env.APP_ADMIN_IDENTIFIER ??= "0600000000";
process.env.APP_ADMIN_PASSWORD ??= "local-test-password";
installFakes();
await import("../_core/index");
