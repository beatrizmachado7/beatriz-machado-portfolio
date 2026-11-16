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

// Renovações das subscrições (manutenções, Designer Dedicada): cada cobrança mensal/anual entra no painel.
const eurTxt = (v) => v.toLocaleString("pt-PT", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + "€";
const cleanDesc = (d) => String(d || "").replace(/^\d+\s*[×x]\s*/, "").replace(/\s*\((at|a|por)\s[^)]*\)\s*$/i, "").trim();
async function clientRenewed(s, { to, nome, product, amount, per }) {
  if (!to) return;
  const sig = await getSignature(s), first = String(nome || "").trim().split(" ")[0], hi = first ? `Olá ${first},` : "Olá,";
  const corpo = [`A renovação de ${product} foi feita com sucesso: ${eurTxt(amount)}${per ? " (" + per + ")" : ""}.`, "Não precisas de fazer nada. Obrigada por continuares comigo!"];
  return sendMail({ to, subject: "Renovação feita com sucesso · " + product, html: mailLayout("Renovação feita", p(hi) + corpo.map((x) => p(x)).join(""), sig), text: `${hi}\n\n${corpo.join("\n\n")}` + signatureText(sig) }).catch((e) => console.error(e));
}

// Email ao cliente quando um pagamento entra (todos os tipos: sinal, final, total, subscrição, extras).
async function clientPaid(s, { to, nome, kind, amount, svc, falta, yearly }) {
  if (!to) return;
  const sig = await getSignature(s), first = String(nome || "").trim().split(" ")[0], E = eurTxt(amount);
  let subject = "Pagamento recebido · " + svc, title = "Pagamento recebido", corpo;
  if (kind === "sinal") {
    subject = "Pagamento recebido: o teu projeto está reservado"; title = "Projeto reservado";
    corpo = [`Recebi o teu pagamento de ${E}, o sinal de 50% do teu projeto (${svc}). O teu lugar na minha agenda está reservado.`, "Nas próximas 24 a 48 horas entro em contacto contigo para combinarmos os detalhes e começarmos."].concat(falta > 0 ? [`Os restantes ${eurTxt(falta)} só são pagos na entrega, quando o projeto estiver pronto.`] : []);
  } else if (kind === "final") corpo = [`Recebi o pagamento final de ${E} (${svc}). O teu projeto está pago na totalidade.`, "Vou enviar-te todos os ficheiros e acessos ainda hoje ou no próximo dia útil."];
  else if (kind === "subscricao") corpo = [`Recebi o teu pagamento de ${E} (${svc}).`, `A partir de agora, o pagamento é feito automaticamente ${yearly ? "todos os anos" : "todos os meses"} no mesmo cartão e envio-te um email sempre que for cobrado.`, "Nas próximas 24 a 48 horas entro em contacto contigo para combinarmos tudo."];
  else corpo = [`Recebi o teu pagamento de ${E} (${svc}).`, "Nas próximas 24 a 48 horas entro em contacto contigo para combinarmos os próximos passos."];
  const hi = first ? `Olá ${first},` : "Olá,";
  return sendMail({ to, subject, html: mailLayout(title, p(hi) + corpo.map((x) => p(x)).join("") + p("Obrigada pela confiança!"), sig), text: `${hi}\n\n${corpo.join("\n\n")}\n\nObrigada pela confiança!` + signatureText(sig) }).catch((e) => console.error(e));
}

async function renewal(ev, req) {
  const inv = (ev.data && ev.data.object) || {};
  // Só as cobranças seguintes: a 1.ª já chega pelo checkout.session.completed.
  if (inv.billing_reason !== "subscription_cycle") return json({ ok: true, ignored: inv.billing_reason || "invoice" });
  const subId = String(inv.subscription || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription) || "").replace(/[^\w-]/g, "");
  if (!subId || !inv.id) return json({ ok: true, noSub: true });
  const s = getCrm(), invId = String(inv.id).replace(/[^\w-]/g, ""), now = new Date();
  let sub = await s.get("subs/" + subId, { type: "json" });
  if (!sub) {
    try { const l = await stripe("checkout/sessions?limit=1&subscription=" + encodeURIComponent(subId), {}, "GET"); const cs = (l.data || [])[0]; if (cs) sub = { session: cs.id, link: cs.payment_link || "" }; } catch (e) { console.error("renewal lookup", e); }
    if (sub) await s.setJSON("subs/" + subId, sub);
  }
  const orig = sub && sub.session ? await s.get("linkpays/" + String(sub.session).replace(/[^\w-]/g, ""), { type: "json" }) : null;
  const lines = (inv.lines && inv.lines.data) || [];
  const product = (orig && orig.product) || cleanDesc(lines.map((x) => x.description).filter(Boolean)[0]) || "Subscrição";
  const per = lines[0] && lines[0].period && lines[0].period.start ? new Date(lines[0].period.start * 1000).toLocaleDateString("pt-PT", { month: "long", year: "numeric", timeZone: "Europe/Lisbon" }) : "";
  const name = inv.customer_name || (orig && orig.name) || "", email = inv.customer_email || (orig && orig.email) || "";
  const who = name || email || "Cliente";

  if (ev.type === "invoice.payment_failed") {
    const amount = Math.round(inv.amount_due || 0) / 100;
    // O Stripe volta a tentar algumas vezes: só avisamos na 1.ª falha.
    if ((inv.attempt_count || 1) > 1) return json({ ok: true, retry: inv.attempt_count });
    if (email) {
      const sig = await getSignature(s), first = String(name || "").trim().split(" ")[0], hi = first ? `Olá ${first},` : "Olá,";
      const link = inv.hosted_invoice_url || "";
      const corpo = [`Não foi possível cobrar a renovação de ${product} (${eurTxt(amount)}${per ? ", " + per : ""}).`, "Normalmente acontece quando o cartão expirou ou não tinha saldo. Para resolver, carrega no botão e paga com um cartão atualizado. Demora menos de um minuto.", "Se precisares de ajuda, responde a este email."];
      await sendMail({ to: email, subject: "Não foi possível renovar: " + product,
        html: mailLayout("Renovação por concluir", p(hi) + corpo.map((x) => p(x)).join("") + (link ? button(link, "Atualizar o pagamento") : ""), sig),
        text: `${hi}\n\n${corpo.join("\n\n")}${link ? "\n\n" + link : ""}` + signatureText(sig) }).catch((e) => console.error(e));
    }
    await notify(s, { type: "payment", title: "Renovação falhou", sub: `${who} · ${eurTxt(amount)} · ${product}` });
    if (env("NOTIFY_EMAIL")) await sendMail({ to: env("NOTIFY_EMAIL"), replyTo: email || undefined, subject: `Renovação falhou: ${product} · ${who}`,
      html: mailLayout("Renovação falhou", rows([["Cliente", name], ["Email", email], ["Plano", product], ["Valor", eurTxt(amount)], ["Período", per]]) + p("O Stripe vai tentar cobrar outra vez automaticamente. Se continuar a falhar, fala com o cliente para atualizar o cartão.")),
      text: `Renovação falhou: ${product}\n${who}${email ? " (" + email + ")" : ""}\n${eurTxt(amount)}` }).catch((e) => console.error(e));
    return json({ ok: true, failed: true });
  }

  const amount = Math.round(inv.amount_paid || 0) / 100;
  if (!(amount > 0)) return json({ ok: true, zero: true });
  const desc = product + " · renovação" + (per ? " (" + per + ")" : "");
  const leadId = orig && orig.leadId;
  const lead = leadId ? await s.get("leads/" + leadId, { type: "json" }) : null;
  if (lead) {
    const pid = "rn" + invId.slice(-14);
    if ((lead.payments || []).some((x) => x.id === pid)) return json({ ok: true });
    const pay = { id: pid, kind: "renovacao", amount, desc, status: "paid", src: "renovacao", sub: subId, invoice: invId, url: "", createdAt: now.toISOString(), paidAt: now.toISOString(), paidOn: lisbonDate(now), method: "card" };
    await s.setJSON("leads/" + lead.id, { ...lead, payments: [...(lead.payments || []), pay], updatedAt: now.toISOString() });
  } else {
    const key = "linkpays/rn_" + invId;
    if (await s.get(key, { type: "json" })) return json({ ok: true });
    await s.setJSON(key, { id: "rn_" + invId, link: (sub && sub.link) || "", amount, currency: inv.currency || "eur", product: desc, name, email, phone: "", status: "paid", method: "card", renewal: true, sub: subId,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), paidAt: now.toISOString(), paidOn: lisbonDate(now) });
  }
  await clientRenewed(s, { to: email, nome: lead ? lead.nome : name, product, amount, per });
  await notify(s, { type: "payment", title: "Renovação recebida", sub: `${lead ? lead.nome : who} · ${eurTxt(amount)} · ${product}`, ...(lead ? { leadId: lead.id } : {}) });
  if (env("NOTIFY_EMAIL")) await sendMail({ to: env("NOTIFY_EMAIL"), replyTo: email || undefined, subject: `Renovação recebida: ${eurTxt(amount)} · ${product} · ${lead ? lead.nome : who}`,
    html: mailLayout("Renovação recebida", rows([["Cliente", lead ? lead.nome : name], ["Email", email], ["Plano", product], ["Valor", eurTxt(amount)], ["Período", per]]) + p(lead ? "Já ficou registada no pedido do cliente e nas contas do painel." : "Já conta nas contas do painel. Em Pagamentos podes associá-la ao pedido do cliente.") + button(siteUrl(req) + "/admin/", "Abrir o painel")),
    text: `Renovação recebida: ${eurTxt(amount)}\n${product}\n${lead ? lead.nome : who}` }).catch((e) => console.error(e));
  return json({ ok: true, renewal: true });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "Falta STRIPE_WEBHOOK_SECRET" }, 500);
  const raw = await req.text();
  if (!verify(raw, req.headers.get("stripe-signature"), secret)) return json({ error: "Assinatura inválida" }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: "JSON inválido" }, 400); }
  if (ev.type === "invoice.paid" || ev.type === "invoice.payment_failed") return renewal(ev, req);
  const types = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"];
  if (!types.includes(ev.type)) return json({ ok: true, ignored: ev.type });
  const ses = ev.data && ev.data.object || {};
  const s = getCrm();
  let map = ses.payment_link ? await s.get("paylinks/" + ses.payment_link, { type: "json" }) : null;
  if (!map && ses.metadata && ses.metadata.leadId) map = { leadId: ses.metadata.leadId, payId: ses.metadata.payId };
  if (!map) {
    // Pagamento feito por um dos links fixos (ex.: «Landing Page · Sinal 50%»): guarda-o para a Beatriz o associar a um pedido no painel.
    if (!ses.payment_link || !ses.id) return json({ ok: true, unknown: true });
    const key = "linkpays/" + String(ses.id).replace(/[^\w-]/g, "");
    if (ses.subscription) await s.setJSON("subs/" + String(ses.subscription).replace(/[^\w-]/g, ""), { session: ses.id, link: ses.payment_link });
    const prev = await s.get(key, { type: "json" });
    if (prev && prev.status === "paid") return json({ ok: true });
    const st = ev.type === "checkout.session.async_payment_failed" ? "failed" : (ses.payment_status === "paid" || ev.type === "checkout.session.async_payment_succeeded") ? "paid" : "waiting";
    let product = (prev && prev.product) || "";
    if (!product) { try { const li = await stripe("checkout/sessions/" + ses.id + "/line_items", {}, "GET"); product = (li.data || []).map((x) => x.description).filter(Boolean).join(", "); } catch (e) { console.error(e); } }
    const cd = ses.customer_details || {}, now = new Date();
    const rec = { ...(prev || {}), id: String(ses.id).replace(/[^\w-]/g, ""), link: ses.payment_link, amount: Math.round(ses.amount_total || 0) / 100, currency: ses.currency || "eur", product, name: cd.name || "", email: cd.email || "", phone: cd.phone || "", status: st, method: (ses.payment_method_types || [])[0] || "", createdAt: (prev && prev.createdAt) || now.toISOString(), updatedAt: now.toISOString(), ...(st === "paid" ? { paidAt: now.toISOString(), paidOn: lisbonDate(now) } : {}) };
    await s.setJSON(key, rec);
    if (st === "paid") {
      await clientPaid(s, { to: rec.email, nome: rec.name, kind: ses.subscription ? "subscricao" : "total", amount: rec.amount, svc: product || "Beatriz Studio", yearly: /anual/i.test(product) });
      const eur = rec.amount.toLocaleString("pt-PT", { minimumFractionDigits: rec.amount % 1 ? 2 : 0 }) + "€";
      const who = rec.name || rec.email || "Cliente";
      await notify(s, { type: "payment", title: "Pagamento recebido por link", sub: `${who} · ${eur}${product ? " · " + product : ""}` });
      if (env("NOTIFY_EMAIL")) await sendMail({ to: env("NOTIFY_EMAIL"), replyTo: rec.email || undefined, subject: `Pagamento recebido: ${eur} · ${product || "link de pagamento"} · ${who}`,
        html: mailLayout("Pagamento recebido", rows([["Cliente", rec.name], ["Email", rec.email], ["Telefone", rec.phone], ["Produto", product], ["Valor", eur]]) + p("Abre o painel, em Pagamentos, e associa este pagamento ao pedido do cliente.") + button(siteUrl(req) + "/admin/", "Abrir o painel")),
        text: `Pagamento recebido: ${eur}\n${who}${rec.email ? " (" + rec.email + ")" : ""}\n${product}\n\nAbre o painel, em Pagamentos, e associa-o ao pedido do cliente.` }).catch((e) => console.error(e));
    }
    return json({ ok: true, linkpay: st });
  }
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
      await Promise.allSettled(tasks);
    } else if (env("NOTIFY_EMAIL")) {
      await sendMail({ to: env("NOTIFY_EMAIL"), subject: `${pay.kind === "sinal" ? "Sinal recebido" : pay.kind === "final" ? "Pagamento final recebido" : "Pagamento recebido"}: ${eur} · ${lead.nome}`,
        html: mailLayout("Pagamento recebido", rows([["Cliente", lead.nome], ["Valor", eur], ["Descrição", pay.desc], ["Email", lead.email]]) + button(siteUrl(req) + "/admin/", "Abrir o painel")),
        text: `Pagamento recebido: ${eur}\n${lead.nome}\n${pay.desc}` });
    }
    // Confirmação ao cliente, para qualquer pagamento de um pedido (site, orçamento automático ou link do painel).
    if (lead.email) {
      const total = lead.quote ? lead.quote.total : +lead.valor || pay.amount;
      const svc2 = lead.subcategoria ? lead.categoria + " — " + lead.subcategoria : lead.plano || lead.servico || pay.desc || "o teu projeto";
      await clientPaid(s, { to: lead.email, nome: lead.nome, kind: pay.kind, amount: pay.amount, svc: svc2, falta: pay.kind === "sinal" ? Math.round((total - pay.amount) * 100) / 100 : 0 });
    }
  }
  return json({ ok: true, status });
};

export const config = { path: "/api/stripe-webhook" };
