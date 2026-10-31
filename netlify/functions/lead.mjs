// Recebe os pedidos de orçamento do site (com ou sem conta) e guarda-os na base de dados (Netlify Blobs).
// Proteção anti-spam invisível: campo armadilha, tempo mínimo de preenchimento e limite por IP.
// Cria uma notificação no painel e envia um email à Beatriz (e ao cliente, se deixou email).
import { json, clean, sha, store, sessionUser, limited, notify, sendMail, mailLayout, p, rows, button, env, siteUrl, emailOk, phoneOk, ip, getSignature, signatureText, stripe, payOn } from "../lib/common.mjs";

// Categorias e subcategorias aceites no formulário de orçamento (iguais às do site).
const CATS = {
  "Websites": ["Landing Page", "Website Completo", "Loja Online", "Ainda não sei"],
  "Identidade Visual": ["Logótipo", "Identidade Visual Completa", "Rebranding", "Estacionário", "Ainda não sei"],
  "Gestão de Redes Sociais": ["Essencial", "Growth", "Premium", "Crescimento"]
};
const PLANS = ["Cuidado do Site"].concat(["Básico", "Pro", "Loja Online"].flatMap((n) => ["Manutenção " + n + " (mensal)", "Manutenção " + n + " (anual)"]));

// Preços fixos (em cêntimos). O valor a pagar é sempre calculado aqui, nunca no navegador.
const PRICES = {
  "Websites": { "Landing Page": 49000, "Website Completo": 99000, "Loja Online": 179000 },
  "Identidade Visual": { "Logótipo": 29000, "Identidade Visual Completa": 79000, "Estacionário": 15000 },
  "Gestão de Redes Sociais": { "Essencial": 15000, "Growth": 25000, "Crescimento": 25000, "Premium": 39000 }
};
const MAINT = { "Básico": [1990, 17910], "Pro": [5990, 53910], "Loja Online": [6990, 62910] };
const eurTxt = (c) => (c / 100).toLocaleString("pt-PT", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }) + "€";
// O que o cliente paga ao reservar: 50% nos projetos, o 1.º mês nos planos mensais, o valor total no plano anual.
export function dueFor(lead) {
  if (lead.plano) {
    const m = /^Manutenção (.+) \((mensal|anual)\)$/.exec(lead.plano);
    if (!m || !MAINT[m[1]]) return null;
    const [mo, yr] = MAINT[m[1]];
    return m[2] === "mensal"
      ? { kind: "mensal", total: mo, now: mo, name: lead.plano, desc: "1.º mês · " + lead.plano }
      : { kind: "total", total: yr, now: yr, name: lead.plano, desc: lead.plano };
  }
  const price = (PRICES[lead.categoria] || {})[lead.subcategoria];
  if (!price) return null;
  const name = lead.categoria + " — " + lead.subcategoria;
  if (lead.categoria === "Gestão de Redes Sociais") return { kind: "mensal", total: price, now: price, name, desc: "1.º mês · Gestão de Redes Sociais " + lead.subcategoria };
  const half = Math.round(price / 2);
  return { kind: "sinal", total: price, now: half, name, desc: "Sinal 50% · " + name };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  if (body["bot-field"]) return json({ ok: true }); // robô: fingimos sucesso
  if (Number(body.t) > 0 && Number(body.t) < 2500) return json({ ok: true }); // preenchido depressa demais

  const s = store();
  const ses = await sessionUser(req, s);
  const u = ses ? ses.user : null;
  if (await limited(s, "lead-ip:" + ip(req), 6, 36e5)) return json({ error: "Recebi vários pedidos seguidos deste dispositivo. Tenta mais tarde ou fala comigo pelo WhatsApp." }, 429);

  const lead = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    type: body.type === "design-partner" ? "design-partner" : "proposta",
    userId: u ? u.id : "",
    nome: clean(body.nome, 200) || (u && u.nome) || "",
    email: (clean(body.email, 200) || (u && u.email) || "").toLowerCase(),
    telefone: clean(body.telefone, 40) || (u && u.telefone) || "",
    marca: clean(body.marca, 200) || (u && u.marca) || "",
    categoria: clean(body.categoria, 80),
    subcategoria: clean(body.subcategoria, 80),
    plano: clean(body.plano, 80),
    servico: clean(body.servico, 200),
    extras: clean(body.extras, 1000),
    total: clean(body.total, 200),
    orcamento: clean(body.orcamento, 60),
    prazo: clean(body.prazo, 60),
    mensagem: clean(body.mensagem, 4000),
    status: "novo",
    notes: "",
    history: []
  };
  if (!lead.nome) return json({ error: "Escreve o teu nome." }, 400);
  if (lead.type === "proposta") {
    // Pedido de orçamento: email obrigatório, telefone opcional, categoria + subcategoria obrigatórias (ou um plano mensal).
    if (!emailOk(lead.email)) return json({ error: "Escreve um email válido para eu te poder responder." }, 400);
    if (lead.telefone && !phoneOk(lead.telefone)) return json({ error: "O número de telefone não parece válido. Podes deixá-lo em branco." }, 400);
    if (lead.plano) {
      if (!PLANS.includes(lead.plano)) return json({ error: "Escolhe o serviço que procuras." }, 400);
      lead.categoria = ""; lead.subcategoria = ""; lead.servico = lead.plano;
    } else {
      if (!CATS[lead.categoria]) return json({ error: "Escolhe o serviço que procuras." }, 400);
      if (!lead.subcategoria) lead.subcategoria = "Ainda não sei";
      if (!CATS[lead.categoria].includes(lead.subcategoria)) return json({ error: "Escolhe a opção que mais se aproxima do teu projeto." }, 400);
      lead.servico = lead.categoria + " — " + lead.subcategoria;
    }
    lead.total = "";
  } else {
    if (!phoneOk(lead.telefone)) return json({ error: "Escreve um número de WhatsApp válido." }, 400);
    if (lead.email && !emailOk(lead.email)) return json({ error: "O email não parece válido." }, 400);
    if (!lead.servico) return json({ error: "Escolhe o serviço que procuras." }, 400);
  }

  // Reserva com pagamento: cria a sessão de pagamento do Stripe e envia o cliente para lá.
  // O formulário já não cobra: o sinal paga-se na página da proposta. Para voltar a cobrar no formulário, CHECKOUT_NO_FORMULARIO=sim.
  const due = lead.type === "proposta" && payOn() && /^(sim|on|true|1)$/i.test(String(env("CHECKOUT_NO_FORMULARIO") || "")) ? dueFor(lead) : null;
  if (due) {
    if (body.termos !== true) return json({ error: "Para reservar, aceita os Termos e Condições." }, 400);
    const site = siteUrl(req);
    const payId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    let ses;
    try {
      ses = await stripe("checkout/sessions", {
        mode: "payment", locale: "pt", customer_email: lead.email,
        line_items: { 0: { quantity: 1, price_data: { currency: "eur", unit_amount: due.now, product_data: { name: due.desc, description: due.kind === "sinal" ? "Total do projeto: " + eurTxt(due.total) + ". Os outros 50% pagam-se na entrega." : undefined } } } },
        success_url: site + "/pagamento/?ok=1", cancel_url: site + "/contacto/?pagamento=cancelado#pedido",
        metadata: { leadId: lead.id, payId, kind: due.kind, src: "site" },
        payment_intent_data: { description: due.desc + " · " + lead.nome, metadata: { leadId: lead.id, payId, kind: due.kind, src: "site" } }
      });
    } catch (e) {
      console.error("checkout", e);
      return json({ error: "Não foi possível abrir o pagamento. Tenta outra vez daqui a pouco ou fala comigo pelo WhatsApp." }, 502);
    }
    const seq = (await s.get("meta/quote-seq", { type: "json" })) || { n: 0 };
    seq.n += 1; await s.setJSON("meta/quote-seq", seq);
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    lead.quote = { token, number: "ORC-" + new Date().getFullYear() + "-" + String(seq.n).padStart(3, "0"), items: [{ d: due.name, det: "", q: 1, v: due.total / 100 }], total: due.total / 100,
      prazo: "", validade: 15, notas: "", origem: "site", createdAt: lead.createdAt, updatedAt: lead.createdAt, sentAt: lead.createdAt };
    await s.setJSON("quotes/" + token, { leadId: lead.id });
    lead.valor = due.total / 100;
    lead.termos = { aceite: true, inicioImediato: true, em: lead.createdAt };
    lead.payments = [{ id: payId, kind: due.kind, src: "site", session: ses.id, url: ses.url, amount: due.now / 100, desc: due.desc, status: "pending", createdAt: lead.createdAt }];
    await s.setJSON("leads/" + lead.id, lead);
    if (u) await s.setJSON("uleads/" + u.id + "/" + lead.id, { at: lead.createdAt });
    else await s.setJSON("eleads/" + sha(lead.email.toLowerCase()) + "/" + lead.id, { at: lead.createdAt });
    return json({ ok: true, id: lead.id, checkout: ses.url });
  }

  await s.setJSON("leads/" + lead.id, lead);
  if (u) await s.setJSON("uleads/" + u.id + "/" + lead.id, { at: lead.createdAt });
  else if (lead.email) await s.setJSON("eleads/" + sha(lead.email.toLowerCase()) + "/" + lead.id, { at: lead.createdAt });
  await notify(s, { type: "lead", title: "Novo pedido de orçamento", sub: `${lead.nome} · ${lead.subcategoria || lead.servico.split(" — ")[0]}${lead.total ? " · " + lead.total : ""}`, leadId: lead.id });

  const site = siteUrl(req);
  const details = rows([["Nome", lead.nome], ["WhatsApp", lead.telefone], ["Email", lead.email], ["Negócio", lead.marca], ...(lead.categoria ? [["Categoria", lead.categoria], ["Subcategoria", lead.subcategoria]] : lead.plano ? [["Plano", lead.plano]] : [["Serviço", lead.servico]]), ["Extras", lead.extras],
    ["Total estimado", lead.total], ["Orçamento", lead.orcamento], ["Prazo", lead.prazo], ["Mensagem", lead.mensagem]]);
  const tasks = [];
  if (env("NOTIFY_EMAIL")) {
    tasks.push(sendMail({
      to: env("NOTIFY_EMAIL"), replyTo: lead.email || undefined,
      subject: `Novo pedido: ${lead.nome} · ${lead.subcategoria || lead.servico.split(" — ")[0]}${lead.total ? " · " + lead.total : ""}`,
      html: mailLayout("Novo pedido de orçamento", details + button(site + "/admin/", "Abrir o painel")),
      text: `Novo pedido de orçamento\n\n${lead.nome} (${[lead.telefone, lead.email].filter(Boolean).join(", ")})${lead.marca ? "\nNegócio: " + lead.marca : ""}\n${lead.servico}${lead.extras ? "\n" + lead.extras : ""}\n${lead.total}${lead.orcamento ? "\nOrçamento: " + lead.orcamento : ""}${lead.prazo ? "\nPrazo: " + lead.prazo : ""}\n\n${lead.mensagem}\n\n${site}/admin/`
    }));
  }
  if (lead.email) {
    const sig = await getSignature(s);
    tasks.push(sendMail({
      to: lead.email,
      subject: "Recebi o teu pedido de orçamento",
      html: mailLayout("Pedido recebido", p(`Olá ${lead.nome.split(" ")[0]},`) +
        p("Obrigada pelo teu pedido. Vou analisar o teu projeto e responder-te" + (lead.telefone ? " pelo WhatsApp ou por email" : " por email") + " em 24 a 48 horas úteis.") +
        p("<b>Próximos passos:</b> 1. Analiso o teu pedido (e, se precisar, faço-te algumas perguntas). 2. Envio-te uma proposta com o valor, o que está incluído e o prazo. 3. Se aprovares, pagas 50% para reservar e o resto só na entrega.") + p("Pedir orçamento não te compromete a nada.") + details, sig),
      text: `Olá ${lead.nome.split(" ")[0]},\n\nObrigada pelo teu pedido. Vou analisar o teu projeto e responder-te${lead.telefone ? " pelo WhatsApp ou por email" : " por email"} em 24 a 48 horas úteis.\n\nPróximos passos:\n1. Analiso o teu pedido (e, se precisar, faço-te algumas perguntas).\n2. Envio-te uma proposta com o valor, o que está incluído e o prazo.\n3. Se aprovares, pagas 50% para reservar e o resto só na entrega.\n\nPedir orçamento não te compromete a nada.\n\n${lead.servico}` + signatureText(sig)
    }));
  }
  await Promise.allSettled(tasks);

  return json({ ok: true, id: lead.id });
};

export const config = { path: "/api/lead" };
