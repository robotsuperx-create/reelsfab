/**
 * First-run setup page, reachable ONLY from this computer (loopback) — never from the internet.
 * Fills the infrastructure part of .env through secure form fields (secrets are never echoed back),
 * builds and tests the Supabase pooler URL from the database password alone, and reloads without a restart.
 * Service API keys are NOT here: they belong in the Integrations page (encrypted vault).
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";
import express, { type Express, type Request, type Response } from "express";
import postgres from "postgres";
import { describeDbError, ensureSeed, getDb, resetDb } from "../db";

const ENV_PATH = join(process.cwd(), ".env");
/**
 * Direct connection from this machine only. A request relayed by a proxy/tunnel also arrives from loopback,
 * so any forwarding header disqualifies it; in production the page closes for good once setup is complete.
 */
const isLoopback = (req: Request) => {
  const ip = req.socket.remoteAddress ?? "";
  const direct = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const forwarded = ["x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip", "x-forwarded-host"].some(h => req.headers[h]);
  const closed = process.env.NODE_ENV === "production" && setupComplete();
  return direct && !forwarded && !closed && /^(localhost|127\.0\.0\.1)$/.test(req.hostname);
};
const sameOrigin = (req: Request) => {
  const origin = req.headers.origin ?? req.headers.referer ?? "";
  return !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(origin));
};
const secret = () => randomBytes(36).toString("base64url");
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function readEnvFile(): Record<string, string> {
  return existsSync(ENV_PATH) ? dotenv.parse(readFileSync(ENV_PATH)) : {};
}

/** Rewrites only the given keys, keeping every other line and comment of .env as it was. */
function writeEnvFile(updates: Record<string, string>) {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const done = new Set<string>();
  const out = lines.map(line => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (m && m[1] in updates) {
      done.add(m[1]);
      return `${m[1]}=${quote(updates[m[1]])}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) if (!done.has(k)) out.push(`${k}=${quote(v)}`);
  writeFileSync(ENV_PATH, out.join("\n").replace(/\n*$/, "\n"));
}
const quote = (v: string) => (/[\s#"'=]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v);

function projectRef(url: string) {
  return /^https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(url)?.[1] ?? "";
}

async function tryConnect(url: string) {
  const sql = postgres(url, { prepare: false, max: 1, ssl: "require", connect_timeout: 8, idle_timeout: 1 });
  try {
    await sql`select 1`;
    return null;
  } catch (e) {
    return describeDbError({ message: "connect", cause: e });
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

/** Builds the Session-pooler URL from the password and finds the right cluster by testing it. */
async function resolvePoolerUrl(ref: string, password: string, region: string) {
  const errors: string[] = [];
  for (const cluster of ["aws-0", "aws-1"]) {
    const url = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${cluster}-${region}.pooler.supabase.com:5432/postgres`;
    const err = await tryConnect(url);
    if (!err) return { url, error: null };
    errors.push(`${cluster}: ${err}`);
    if (/28P01|password/i.test(err)) break; // reached the right server: the password itself is wrong
  }
  return { url: null, error: errors.join("\n") };
}

/** Template values copied from .env.example count as missing. */
const real = (v?: string) => Boolean(v && !/your-project|your-supabase|\[PASSWORD\]|\[YOUR-PASSWORD\]|you@example\.com|generate-a-long/i.test(v));

export function setupStatus() {
  const e = process.env;
  return {
    supabaseUrl: real(e.SUPABASE_URL) && /^https:\/\/[^/\s]+/.test(e.SUPABASE_URL ?? ""),
    anonKey: real(e.SUPABASE_ANON_KEY),
    serviceKey: real(e.SUPABASE_SERVICE_ROLE_KEY),
    dbUrl: real(e.SUPABASE_DB_URL) || real(e.DATABASE_URL),
    admin: real(e.APP_ADMIN_IDENTIFIER) && real(e.APP_ADMIN_PASSWORD),
    secrets: real(e.SESSION_SECRET) && real(e.CRON_SECRET) && real(e.INTEGRATION_ENCRYPTION_KEY),
  };
}
/** The public anon key only enables Supabase sign-in; the local admin login works without it. */
export const setupComplete = () => {
  const { anonKey: _optional, ...required } = setupStatus();
  return Object.values(required).every(Boolean);
};

function page(opts: { message?: string; error?: string; dbOk?: boolean | null }) {
  const st = setupStatus();
  const e = process.env;
  const row = (ok: boolean, label: string) => `<li class="${ok ? "ok" : "no"}">${ok ? "✓" : "✗"} ${label}</li>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ReellllLocaL — الإعداد الأول</title><style>
:root{--bg:#0b0b0a;--card:#151513;--line:#2a2a26;--fg:#f2f2ee;--mut:#9a9a90;--lime:#DFFF00;--red:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 system-ui,"Segoe UI",Tahoma,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:32px 16px 64px}h1{margin:0 0 4px;font-size:30px}.k{color:var(--lime);font:600 11px monospace;letter-spacing:.15em}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-top:16px}
h2{margin:0 0 12px;font-size:17px}label{display:block;margin:12px 0 4px;color:var(--mut);font-size:13px}
input{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:#0e0e0c;color:var(--fg);font:14px monospace;direction:ltr}
input:focus{outline:2px solid var(--lime);border-color:transparent}.hint{color:var(--mut);font-size:12px;margin-top:4px}
button{margin-top:20px;width:100%;padding:13px;border:0;border-radius:12px;background:var(--lime);color:#111;font-weight:700;font-size:16px;cursor:pointer}
ul{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:6px}.ok{color:#9be37a}.no{color:var(--red)}
.msg{padding:12px 14px;border-radius:12px;margin-top:16px;white-space:pre-wrap}.good{background:#1d2a12;border:1px solid #4b6b1f}.bad{background:#2a1414;border:1px solid #6b2a2a}
a{color:var(--lime)}code{background:#222;padding:1px 6px;border-radius:6px}
</style></head><body><div class="wrap">
<div class="k">LOCAL SETUP · 127.0.0.1 ONLY</div><h1>الإعداد الأول</h1>
<p style="color:var(--mut)">هذه الصفحة تعمل على جهازك فقط ولا يمكن فتحها من الإنترنت. القيم السرية تُحفظ في ملف <code>.env</code> على جهازك ولا تُعرض مرة أخرى. مفاتيح الخدمات (Claude، Higgsfield…) تضيفها بعد الدخول من <b>مركز التكاملات</b>.</p>
${opts.message ? `<div class="msg good">${esc(opts.message)}</div>` : ""}${opts.error ? `<div class="msg bad">${esc(opts.error)}</div>` : ""}
<div class="card"><h2>الحالة</h2><ul>
${row(st.supabaseUrl, "مشروع Supabase")}${row(st.serviceKey, "مفتاح service_role")}
${row(st.dbUrl && opts.dbOk !== false, "قاعدة البيانات")}${row(st.admin, "دخول المدير")}
${row(st.secrets, "الأسرار والخزنة")}${row(setupComplete() && opts.dbOk !== false, "جاهز للتشغيل")}
</ul></div>
<form method="post" action="/setup" autocomplete="off">
<div class="card"><h2>Supabase</h2>
<label>رابط المشروع</label><input name="SUPABASE_URL" value="${esc(real(e.SUPABASE_URL) ? e.SUPABASE_URL! : "")}" placeholder="https://xxxx.supabase.co">
<label>المفتاح العام anon</label><input name="SUPABASE_ANON_KEY" value="${esc(real(e.SUPABASE_ANON_KEY) ? e.SUPABASE_ANON_KEY! : "")}">
<label>مفتاح service_role ${real(e.SUPABASE_SERVICE_ROLE_KEY) ? "(محفوظ — اتركه فارغًا لعدم تغييره)" : ""}</label>
<input type="password" name="SUPABASE_SERVICE_ROLE_KEY" placeholder="${real(e.SUPABASE_SERVICE_ROLE_KEY) ? "••••••••" : "Project Settings › API Keys › service_role"}">
<label>كلمة مرور قاعدة البيانات ${real(e.SUPABASE_DB_URL) ? "(الرابط محفوظ — اكتبها فقط لتغييره)" : ""}</label>
<input type="password" name="DB_PASSWORD" placeholder="كلمة مرور القاعدة (ليست كلمة مرور حسابك)">
<div class="hint">النظام يبني رابط Session pooler ويختبره تلقائيًا، ويُرمّز الرموز الخاصة بنفسه. نسيتها؟ Project Settings › Database › Reset database password.</div>
<label>المنطقة</label><input name="SUPABASE_DB_POOLER_REGION" value="${esc(e.SUPABASE_DB_POOLER_REGION ?? "eu-west-1")}">
</div>
<div class="card"><h2>دخول المدير</h2>
<label>المعرّف</label><input name="APP_ADMIN_IDENTIFIER" value="${esc(e.APP_ADMIN_IDENTIFIER ?? "")}" placeholder="مثال: oussama">
<label>كلمة المرور ${real(e.APP_ADMIN_PASSWORD) ? "(محفوظة — اتركها فارغة لعدم تغييرها)" : ""}</label>
<input type="password" name="APP_ADMIN_PASSWORD" minlength="10" placeholder="10 أحرف على الأقل">
</div>
<div class="card"><h2>الأسرار</h2><p class="hint" style="margin:0">تُولَّد تلقائيًا إن لم تكن موجودة: SESSION_SECRET و CRON_SECRET و INTEGRATION_ENCRYPTION_KEY.
<b>بعد الحفظ انسخ ملف .env إلى مكان آمن</b> — مفتاح الخزنة إن ضاع تضيع كل المفاتيح المحفوظة في مركز التكاملات.</p></div>
<button type="submit">حفظ واختبار الاتصال</button></form>
${setupComplete() && opts.dbOk ? `<p style="text-align:center;margin-top:20px"><a href="/">← افتح المصنع وسجّل الدخول، ثم اذهب إلى مركز التكاملات</a></p>` : ""}
</div></body></html>`;
}

async function dbHealthy() {
  try {
    const db = await getDb();
    if (!db) return false;
    await ensureSeed();
    return true;
  } catch (e) {
    lastDbError = describeDbError(e);
    return false;
  }
}
let lastDbError = "";

export function registerSetupRoutes(app: Express) {
  app.get("/setup", async (req: Request, res: Response) => {
    if (!isLoopback(req)) return res.status(404).send("Not found");
    res.set("Cache-Control", "no-store");
    const dbOk = setupStatus().dbUrl ? await dbHealthy() : null;
    const ok = req.query.saved === "1";
    res.type("html").send(page({ message: ok && dbOk ? "تم الحفظ والاتصال بقاعدة البيانات بنجاح، وزُرعت الشخصيات وصورها." : undefined, error: dbOk === false ? `تعذّر الاتصال بقاعدة البيانات:\n${lastDbError}` : undefined, dbOk }));
  });

  app.post("/setup", express.urlencoded({ extended: false, limit: "20kb" }), async (req: Request, res: Response) => {
    if (!isLoopback(req)) return res.status(404).send("Not found");
    if (!sameOrigin(req)) return res.status(403).send("Forbidden");
    const b = req.body as Record<string, string>;
    const current = readEnvFile();
    const updates: Record<string, string> = {};
    const set = (k: string, v?: string) => { if (v && v.trim()) updates[k] = v.trim(); };
    set("SUPABASE_URL", b.SUPABASE_URL?.replace(/\/+$/, ""));
    set("SUPABASE_ANON_KEY", b.SUPABASE_ANON_KEY);
    set("SUPABASE_SERVICE_ROLE_KEY", b.SUPABASE_SERVICE_ROLE_KEY);
    set("SUPABASE_DB_POOLER_REGION", b.SUPABASE_DB_POOLER_REGION);
    set("APP_ADMIN_IDENTIFIER", b.APP_ADMIN_IDENTIFIER);
    if (b.APP_ADMIN_PASSWORD && b.APP_ADMIN_PASSWORD.length < 10) {
      return res.type("html").send(page({ error: "كلمة مرور المدير قصيرة: 10 أحرف على الأقل.", dbOk: null }));
    }
    set("APP_ADMIN_PASSWORD", b.APP_ADMIN_PASSWORD);
    for (const k of ["SESSION_SECRET", "CRON_SECRET", "INTEGRATION_ENCRYPTION_KEY"]) if (!real(current[k]) && !real(process.env[k])) updates[k] = secret();
    if (!current.SUPABASE_STORAGE_BUCKET && !process.env.SUPABASE_STORAGE_BUCKET) updates.SUPABASE_STORAGE_BUCKET = "reelsfab";

    if (b.DB_PASSWORD) {
      const ref = projectRef(updates.SUPABASE_URL ?? process.env.SUPABASE_URL ?? "");
      if (!ref) return res.type("html").send(page({ error: "أدخل رابط مشروع Supabase الصحيح أولًا (https://xxxx.supabase.co).", dbOk: null }));
      const region = updates.SUPABASE_DB_POOLER_REGION ?? process.env.SUPABASE_DB_POOLER_REGION ?? "eu-west-1";
      const r = await resolvePoolerUrl(ref, b.DB_PASSWORD, region);
      if (!r.url) return res.type("html").send(page({ error: `لم يُحفظ شيء — تعذّر الاتصال بقاعدة البيانات:\n${r.error}`, dbOk: false }));
      updates.SUPABASE_DB_URL = r.url;
    }

    writeEnvFile(updates);
    dotenv.config({ path: ENV_PATH, override: true, quiet: true } as dotenv.DotenvConfigOptions);
    await resetDb();
    res.redirect(303, "/setup?saved=1");
  });

  // On this computer, an unconfigured app opens the setup page instead of a broken login screen.
  app.use((req, res, next) => {
    if (req.method === "GET" && req.path === "/" && isLoopback(req) && !setupComplete()) return res.redirect("/setup");
    next();
  });
}
