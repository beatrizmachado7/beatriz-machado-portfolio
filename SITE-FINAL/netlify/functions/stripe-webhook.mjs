// Recebe os avisos do Stripe quando um cliente paga (cartão, MB WAY ou Multibanco).
// Marca o pagamento como pago no pedido, o que o faz aparecer no Resumo do painel, e avisa a Beatriz.
import { createHmac, timingSafeEqual } from "node:crypto";
import { json, env, store as getCrm, notify, sendMail, mailLayout, rows, button, siteUrl, stripe, lisbonDate } from "../lib/common.mjs";

function verify(raw, header, secret) {
  const parts = Object.fromEntries(String(header || "").split(",").map((x) => x.split("=")).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = String(header || "").split(",").filter((x) => x.trim().startsWith("v1=")).map((x) => x.trim().slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const exp = Buffer.from(createHmac("sha256", secret).update(parts.t + "." + raw).digest("hex"));
  return sigs.some((s) => { const b = Buffer.from(s); return b.length === exp.length && timingSafeEqual(b, exp); });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "Falta STRIPE_WEBHOOK_SECRET" }, 500);
  const raw = await req.text();
  if (!verify(raw, req.headers.get("stripe-signature"), secret)) return json({ error: "Assinatura inválida" }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: "JSON inválido" }, 400); }
  const types = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"];
  if (!types.includes(ev.type)) return json({ ok: true, ignored: ev.type });
  const ses = ev.data && ev.data.object || {};
  const s = getCrm();
  let map = ses.payment_link ? await s.get("paylinks/" + ses.payment_link, { type: "json" }) : null;
  if (!map && ses.metadata && ses.metadata.leadId) map = { leadId: ses.metadata.leadId, payId: ses.metadata.payId };
  if (!map) return json({ ok: true, unknown: true });
  const lead = await s.get("leads/" + map.leadId, { type: "json" });
  if (!lead) return json({ ok: true, noLead: true });
  const pay = (lead.payments || []).find((x) => x.id === map.payId);
  if (!pay || pay.status === "paid") return json({ ok: true });

  let status = pay.status;
  if (ev.type === "checkout.session.async_payment_failed") status = "failed";
  else if (ses.payment_status === "paid" || ev.type === "checkout.session.async_payment_succeeded") status = "paid";
  else status = "waiting"; // ex.: referência Multibanco gerada, à espera do pagamento

  const now = new Date();
  const upd = { ...lead, updatedAt: now.toISOString(), payments: lead.payments.map((x) => (x.id === pay.id ? { ...x, status, ...(status === "paid" ? { paidAt: now.toISOString(), paidOn: lisbonDate(now), method: (ses.payment_method_types || [])[0] || "" } : {}) } : x)) };
  if (status === "paid" && pay.kind !== "sinal") { upd.pago = true; upd.pagoEm = lisbonDate(now); }
  if (status === "paid" && pay.kind === "sinal") { upd.sinalEm = lisbonDate(now); }
  await s.setJSON("leads/" + lead.id, upd);

  if (status === "paid") {
    if (pay.link) { try { await stripe("payment_links/" + pay.link, { active: "false" }); } catch (e) { console.error(e); } }
    const eur = pay.amount.toLocaleString("pt-PT", { minimumFractionDigits: pay.amount % 1 ? 2 : 0 }) + "€";
    await notify(s, { type: "payment", title: pay.kind === "sinal" ? "Sinal recebido (50%)" : pay.kind === "final" ? "Pagamento final recebido" : "Pagamento recebido", sub: `${lead.nome} · ${eur}`, leadId: lead.id });
    if (env("NOTIFY_EMAIL")) {
      await sendMail({ to: env("NOTIFY_EMAIL"), subject: `${pay.kind === "sinal" ? "Sinal recebido" : pay.kind === "final" ? "Pagamento final recebido" : "Pagamento recebido"}: ${eur} · ${lead.nome}`,
        html: mailLayout("Pagamento recebido", rows([["Cliente", lead.nome], ["Valor", eur], ["Descrição", pay.desc], ["Email", lead.email]]) + button(siteUrl(req) + "/admin/", "Abrir o painel")),
        text: `Pagamento recebido: ${eur}\n${lead.nome}\n${pay.desc}` });
    }
  }
  return json({ ok: true, status });
};

export const config = { path: "/api/stripe-webhook" };
