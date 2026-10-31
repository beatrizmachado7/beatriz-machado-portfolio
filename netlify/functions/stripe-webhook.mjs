// Recebe os avisos do Stripe quando um cliente paga (cartão, MB WAY ou Multibanco).
// Marca o pagamento como pago no pedido, o que o faz aparecer no Resumo do painel, e avisa a Beatriz.
import { createHmac, timingSafeEqual } from "node:crypto";
import { json, env, store as getCrm, notify, sendMail, mailLayout, rows, button, p, siteUrl, stripe, lisbonDate, getSignature, signatureText } from "../lib/common.mjs";

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
    if (pay.src === "site") {
      // Reserva feita no site: aviso completo à Beatriz e confirmação automática ao cliente.
      const total = lead.quote ? lead.quote.total : pay.amount;
      const fmt = (v) => v.toLocaleString("pt-PT", { minimumFractionDigits: v % 1 ? 2 : 0 }) + "€";
      const falta = pay.kind === "sinal" ? Math.round((total - pay.amount) * 100) / 100 : 0;
      const svc = lead.subcategoria ? lead.categoria + " — " + lead.subcategoria : lead.plano || lead.servico;
      const tasks = [];
      if (env("NOTIFY_EMAIL")) tasks.push(sendMail({ to: env("NOTIFY_EMAIL"), replyTo: lead.email || undefined,
        subject: `Novo projeto pago: ${svc} · ${eur} · ${lead.nome}`,
        html: mailLayout("Novo projeto pago", p(pay.kind === "sinal" ? "Um cliente reservou um projeto e pagou o sinal de 50%." : pay.kind === "mensal" ? "Um cliente subscreveu um plano mensal e pagou o 1.º mês." : "Um cliente pagou um serviço.") +
          rows([["Cliente", lead.nome], ["Email", lead.email], ["WhatsApp", lead.telefone], ["Marca", lead.marca], ["Serviço", svc], ["Pago agora", eur], ["Falta pagar", falta ? fmt(falta) + " (na entrega)" : ""], ["Mensagem", lead.mensagem]]) +
          p("Próximo passo: abre o pedido no painel e carrega em «Avisar que comecei».") + button(siteUrl(req) + "/admin/", "Abrir o painel")),
        text: `Novo projeto pago: ${svc}\n${lead.nome} (${[lead.email, lead.telefone].filter(Boolean).join(", ")})\nPago agora: ${eur}${falta ? "\nFalta pagar: " + fmt(falta) : ""}\n\n${lead.mensagem || ""}` }));
      if (lead.email) {
        const sig = await getSignature(s);
        const first = String(lead.nome || "").split(" ")[0];
        const corpo = pay.kind === "sinal"
          ? [`Recebi o teu pagamento de ${eur}, o sinal de 50% do teu projeto (${svc}). O teu lugar na minha agenda está reservado.`,
             `Nas próximas 24 a 48 horas entro em contacto contigo para combinarmos os detalhes e começarmos.`,
             `Os restantes ${fmt(falta)} só são pagos na entrega, quando o projeto estiver pronto.`]
          : pay.kind === "mensal"
          ? [`Recebi o teu pagamento de ${eur}, referente ao 1.º mês de ${svc}.`, `Nas próximas 24 a 48 horas entro em contacto contigo para combinarmos tudo e começarmos.`, `Nos meses seguintes envio-te o link de pagamento no início de cada mês.`]
          : [`Recebi o teu pagamento de ${eur} (${svc}).`, `Nas próximas 24 a 48 horas entro em contacto contigo para combinarmos os próximos passos.`];
        tasks.push(sendMail({ to: lead.email, subject: "Pagamento recebido: o teu projeto está reservado",
          html: mailLayout("Projeto reservado", p(`Olá ${first},`) + corpo.map((x) => p(x)).join("") + p("Obrigada pela confiança!"), sig),
          text: `Olá ${first},\n\n${corpo.join("\n\n")}\n\nObrigada pela confiança!` + signatureText(sig) }));
      }
      await Promise.allSettled(tasks);
    } else if (env("NOTIFY_EMAIL")) {
      await sendMail({ to: env("NOTIFY_EMAIL"), subject: `${pay.kind === "sinal" ? "Sinal recebido" : pay.kind === "final" ? "Pagamento final recebido" : "Pagamento recebido"}: ${eur} · ${lead.nome}`,
        html: mailLayout("Pagamento recebido", rows([["Cliente", lead.nome], ["Valor", eur], ["Descrição", pay.desc], ["Email", lead.email]]) + button(siteUrl(req) + "/admin/", "Abrir o painel")),
        text: `Pagamento recebido: ${eur}\n${lead.nome}\n${pay.desc}` });
    }
  }
  return json({ ok: true, status });
};

export const config = { path: "/api/stripe-webhook" };
