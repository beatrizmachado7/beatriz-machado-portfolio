// Funções partilhadas pelas APIs do site (contas de cliente, pedidos e painel).
import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

export const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k]);
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
export const clean = (v, max = 2000) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
export const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
export const store = () => getStore({ name: "crm", consistency: "strong" });
export const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const phoneOk = (t) => { const n = String(t || "").replace(/\D/g, ""); return n.length >= 9 && n.length <= 15; };
export const userKey = (email) => "users/" + sha(String(email).toLowerCase());
export const ip = (req) => req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "local";

/* ---------- palavras-passe ---------- */
export function hashPw(pw) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(String(pw), salt, 64).toString("hex") };
}
export function checkPw(pw, rec) {
  if (!rec || !rec.salt) return false;
  const a = scryptSync(String(pw), rec.salt, 64), b = Buffer.from(rec.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export const newCode = () => String(randomInt(0, 1000000)).padStart(6, "0");
export const newToken = () => randomBytes(32).toString("base64url");

/* ---------- sessões de cliente ---------- */
const SESSION_DAYS = 30;
export async function createSession(s, user) {
  const token = newToken();
  await s.setJSON("sessions/" + sha(token), { uid: user.id, email: user.email, exp: Date.now() + SESSION_DAYS * 864e5 });
  return token;
}
export async function sessionUser(req, s) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const key = "sessions/" + sha(m[1].trim());
  const ses = await s.get(key, { type: "json" });
  if (!ses || ses.exp < Date.now()) { if (ses) await s.delete(key); return null; }
  const user = await s.get(userKey(ses.email), { type: "json" });
  if (!user || user.status !== "active") return null;
  return { user, key };
}
export const publicUser = (u) => ({ id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, marca: u.marca || "", createdAt: u.createdAt });

/* ---------- limite de tentativas ---------- */
export async function limited(s, key, max, windowMs) {
  const k = "rate/" + sha(key), now = Date.now();
  const r = (await s.get(k, { type: "json" })) || { hits: [] };
  r.hits = r.hits.filter((t) => now - t < windowMs);
  if (r.hits.length >= max) return true;
  r.hits.push(now);
  await s.setJSON(k, r);
  return false;
}

/* ---------- notificações do painel ---------- */
export async function notify(s, n) {
  const at = new Date().toISOString();
  const id = at.replace(/[^\d]/g, "") + "-" + randomBytes(3).toString("hex");
  await s.setJSON("notifs/" + id, Object.assign({ id, at, read: false }, n));
}

/* ---------- emails (Resend) ---------- */
export const mailReady = () => !!(env("RESEND_API_KEY") && env("MAIL_FROM"));
export async function sendMail({ to, subject, html, text, replyTo }) {
  if (!mailReady()) return { ok: false, skipped: true };
  try {
    const r = await fetch(env("MAIL_API_URL") || "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env("RESEND_API_KEY"), "content-type": "application/json" },
      body: JSON.stringify({ from: env("MAIL_FROM"), to: [to], subject, html, text, reply_to: replyTo || env("REPLY_TO") || "beatrizmachadostudio@gmail.com" })
    });
    if (!r.ok) console.error("Resend", r.status, await r.text().catch(() => ""));
    return { ok: r.ok };
  } catch (e) {
    console.error("Resend", e);
    return { ok: false };
  }
}
const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function mailLayout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#F6F3ED;font-family:Arial,Helvetica,sans-serif;color:#15130F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3ED;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E7E1D6">
<tr><td style="padding:28px 32px 0"><span style="display:inline-block;border:1px solid #B8860B;color:#B8860B;font-weight:bold;font-size:12px;padding:6px 7px">BM</span>
<span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#B8860B;margin-left:10px">Beatriz Machado Studio</span></td></tr>
<tr><td style="padding:22px 32px 32px"><h1 style="font-size:22px;margin:0 0 14px;font-weight:600">${escH(title)}</h1>${bodyHtml}</td></tr>
</table><p style="font-size:11px;color:#6E675B;margin:16px 0 0">Web Design &amp; Brand Identity · beatrizstudio.pt</p></td></tr></table></body></html>`;
}
export const p = (t) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;color:#3D3830">${escH(t)}</p>`;
export const codeBox = (c) => `<p style="font-size:34px;letter-spacing:10px;font-weight:bold;margin:8px 0 18px;color:#15130F">${escH(c)}</p>`;
export function rows(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E7E1D6;margin:6px 0 16px">${list
    .filter((r) => r[1])
    .map((r) => `<tr><td style="padding:9px 0;border-bottom:1px solid #E7E1D6;font-size:12px;color:#6E675B;text-transform:uppercase;letter-spacing:1px;width:120px;vertical-align:top">${escH(r[0])}</td><td style="padding:9px 0;border-bottom:1px solid #E7E1D6;font-size:14px">${escH(r[1])}</td></tr>`)
    .join("")}</table>`;
}
export const button = (href, label) =>
  `<p style="margin:18px 0 4px"><a href="${escH(href)}" style="display:inline-block;background:#B8860B;color:#FFFFFF;text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:13px 20px">${escH(label)}</a></p>`;
export const siteUrl = (req) => env("SITE_URL") || new URL(req.url).origin;
