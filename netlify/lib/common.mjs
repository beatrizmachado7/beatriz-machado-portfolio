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
export async function sendMail({ to, subject, html, text, replyTo, attachments }) {
  if (!mailReady()) return { ok: false, skipped: true };
  try {
    const r = await fetch(env("MAIL_API_URL") || "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env("RESEND_API_KEY"), "content-type": "application/json" },
      body: JSON.stringify({ from: env("MAIL_FROM"), to: [to], subject, html, text, reply_to: replyTo || env("REPLY_TO") || "beatrizmachadostudio@gmail.com", ...(attachments && attachments.length ? { attachments } : {}) })
    });
    if (!r.ok) console.error("Resend", r.status, await r.text().catch(() => ""));
    return { ok: r.ok };
  } catch (e) {
    console.error("Resend", e);
    return { ok: false };
  }
}
export const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function mailLayout(title, bodyHtml, sig) {
  return `<!doctype html><html><body style="margin:0;background:#F6E9E6;font-family:Helvetica,Arial,sans-serif;color:#2A1216">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6E9E6;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#FFFFFF;border:1px solid #EBD7DA;border-radius:22px">
<tr><td style="padding:30px 34px 0;font-size:22px;font-weight:bold;letter-spacing:-0.5px;color:#350E17">beatriz studio<span style="color:#E3A58C">.</span></td></tr>
<tr><td style="padding:22px 34px 34px"><h1 style="font-size:22px;margin:0 0 16px;font-weight:600;line-height:1.25">${escH(title)}</h1>${bodyHtml}${sig ? signatureHtml(sig) : ""}</td></tr>
</table><p style="font-size:11px;color:#74545A;margin:16px 0 0">Websites · Identidade Visual · Templates · beatrizstudio.pt</p></td></tr></table></body></html>`;
}
export const mailText = (t) => String(t || "").split(/\n{2,}/).map((para) => `<p style="font-size:15px;line-height:1.6;margin:0 0 14px;color:#3A332D">${escH(para).replace(/\n/g, "<br>")}</p>`).join("");
export const p = (t) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;color:#3D3830">${escH(t)}</p>`;
// Parágrafo com HTML já seguro (só para texto fixo; dados do cliente passam por escH).
export const pH = (h) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;color:#3D3830">${h}</p>`;
export const codeBox = (c) => `<p style="font-size:34px;letter-spacing:10px;font-weight:bold;margin:8px 0 18px;color:#15130F">${escH(c)}</p>`;
export function rows(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #EBD7DA;margin:6px 0 16px">${list
    .filter((r) => r[1])
    .map((r) => `<tr><td style="padding:9px 0;border-bottom:1px solid #EBD7DA;font-size:12px;color:#74545A;text-transform:uppercase;letter-spacing:1px;width:120px;vertical-align:top">${escH(r[0])}</td><td style="padding:9px 0;border-bottom:1px solid #EBD7DA;font-size:14px">${escH(r[1])}</td></tr>`)
    .join("")}</table>`;
}
export const button = (href, label) =>
  `<p style="margin:18px 0 4px"><a href="${escH(href)}" style="display:inline-block;background:#350E17;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:bold;padding:13px 22px;border-radius:999px">${escH(label)}</a></p>`;
export const siteUrl = (req) => env("SITE_URL") || new URL(req.url).origin;

/* ---------- Stripe (pagamentos) ---------- */
export const stripeReady = () => !!env("STRIPE_SECRET_KEY");
// Reserva com pagamento no formulário do site: só fica ligada quando PAGAMENTOS_ATIVOS = sim no Netlify.
export const payOn = () => stripeReady() && /^(sim|on|true|1)$/i.test(String(env("PAGAMENTOS_ATIVOS") || "").trim());
export async function stripe(path, params, method = "POST") {
  const body = new URLSearchParams();
  const add = (k, v) => { if (v === undefined || v === null || v === "") return; if (typeof v === "object") Object.entries(v).forEach(([kk, vv]) => add(k + "[" + kk + "]", vv)); else body.append(k, String(v)); };
  Object.entries(params || {}).forEach(([k, v]) => add(k, v));
  const r = await fetch((env("STRIPE_API_URL") || "https://api.stripe.com") + "/v1/" + path, {
    method, headers: { authorization: "Bearer " + env("STRIPE_SECRET_KEY"), "content-type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : body
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("Stripe", r.status, j); const e = new Error((j.error && j.error.message) || "Erro do Stripe " + r.status); e.status = r.status; throw e; }
  return j;
}
export const lisbonDate = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });

/* ---------- assinatura dos emails ---------- */
export const DEFAULT_SIG = { nome: "Beatriz Machado", cargo: "Beatriz Studio · Websites e identidade visual", email: "beatrizmachadostudio@gmail.com", telefone: "+351 936 507 808", site: "beatrizstudio.pt", instagram: "@beatrizstudio.pt", frase: "" };
const OLD_CARGO = "Websites · Identidade Visual · Templates";
export async function getSignature(s, senderName) {
  let sig = null;
  try { sig = await s.get("templates/cfg-signature", { type: "json" }); } catch (e) { console.error(e); }
  sig = { ...DEFAULT_SIG, ...(sig || {}) };
  // Assinaturas guardadas antes do rebranding: atualiza o cargo antigo e repõe o WhatsApp.
  if (!sig.cargo || sig.cargo === OLD_CARGO) sig.cargo = DEFAULT_SIG.cargo;
  if (!sig.telefone) sig.telefone = DEFAULT_SIG.telefone;
  if (senderName) sig.nome = senderName;
  return sig;
}
const linkS = (href, t) => `<a href="${escH(href)}" style="color:#8A3446;text-decoration:none">${escH(t)}</a>`;
// A mesma assinatura do Gmail (rebranding 2026): círculo «b.» bordô + nome, cargo e contactos.
export function signatureHtml(g) {
  const site = String(g.site || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const ig = String(g.instagram || "").replace(/^@/, "");
  const wa = String(g.telefone || "").replace(/\D/g, "");
  const A = (href, t, bold) => `<a href="${escH(href)}" style="color:#350E17;text-decoration:none${bold ? ";font-weight:bold" : ""}">${escH(t)}</a>`;
  const dot = '<span style="color:#F0C2AE">&nbsp;&bull;&nbsp;</span>';
  const bits = [site && A("https://" + site, site, true), wa && A("https://api.whatsapp.com/send?phone=" + wa, "WhatsApp\u00a0" + String(g.telefone).replace(/ /g, "\u00a0")), ig && A("https://www.instagram.com/" + ig + "/", "@" + ig)].filter(Boolean);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;border-top:1px solid #EBD7DA;width:100%"><tr><td style="padding-top:22px">
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif"><tr>
<td valign="middle" style="padding:0 18px 0 0"><table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
<td width="64" height="64" align="center" valign="middle" bgcolor="#350E17" style="width:64px;height:64px;background-color:#350E17;border-radius:32px;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:64px;font-weight:bold;color:#FFFFFF;letter-spacing:-1px">b<span style="color:#F0C2AE">.</span></td>
</tr></table></td>
<td valign="middle" style="padding:0 0 0 18px;border-left:2px solid #F0C2AE">
<p style="margin:0;font-size:16px;line-height:20px;font-weight:bold;color:#350E17">${escH(g.nome || "")}</p>
${g.cargo ? `<p style="margin:2px 0 8px;font-size:13px;line-height:18px;color:#7A4A53">${escH(g.cargo)}</p>` : ""}
${bits.length ? `<p style="margin:0;font-size:13px;line-height:20px;color:#350E17">${bits.join(dot)}</p>` : ""}
${g.frase ? `<p style="margin:8px 0 0;font-size:12.5px;line-height:18px;color:#7A4A53;font-style:italic">${escH(g.frase)}</p>` : ""}
</td></tr></table>
</td></tr></table>`;
}
export function signatureText(g) {
  return "\n\n--\n" + [g.nome, g.cargo, [g.site, g.telefone && "WhatsApp " + g.telefone, g.instagram].filter(Boolean).join(" · "), g.frase].filter(Boolean).join("\n");
}
