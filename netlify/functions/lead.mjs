// Recebe os pedidos de orçamento do site (com ou sem conta) e guarda-os na base de dados (Netlify Blobs).
// Proteção anti-spam invisível: campo armadilha, tempo mínimo de preenchimento e limite por IP.
// Cria uma notificação no painel e envia um email à Beatriz (e ao cliente, se deixou email).
import { json, clean, sha, store, sessionUser, limited, notify, sendMail, mailLayout, p, rows, button, env, siteUrl, emailOk, phoneOk, ip } from "../lib/common.mjs";

// Categorias e subcategorias aceites no formulário de orçamento (iguais às do site).
const CATS = {
  "Websites": ["Landing Page", "Website Completo", "Loja Online"],
  "Identidade Visual": ["Logótipo", "Identidade Visual Completa", "Estacionário"],
  "Gestão de Redes Sociais": ["Essencial", "Crescimento", "Premium"]
};
const PLANS = ["Cuidado do Site"].concat(["Básico", "Pro", "Loja Online"].flatMap((n) => ["Manutenção " + n + " (mensal)", "Manutenção " + n + " (anual)"]));

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
      if (!CATS[lead.categoria].includes(lead.subcategoria)) return json({ error: "Escolhe a opção que mais se aproxima do teu projeto." }, 400);
      lead.servico = lead.categoria + " — " + lead.subcategoria;
    }
    lead.extras = ""; lead.total = "";
  } else {
    if (!phoneOk(lead.telefone)) return json({ error: "Escreve um número de WhatsApp válido." }, 400);
    if (lead.email && !emailOk(lead.email)) return json({ error: "O email não parece válido." }, 400);
    if (!lead.servico) return json({ error: "Escolhe o serviço que procuras." }, 400);
  }

  await s.setJSON("leads/" + lead.id, lead);
  if (u) await s.setJSON("uleads/" + u.id + "/" + lead.id, { at: lead.createdAt });
  else if (lead.email) await s.setJSON("eleads/" + sha(lead.email.toLowerCase()) + "/" + lead.id, { at: lead.createdAt });
  await notify(s, { type: "lead", title: "Novo pedido de orçamento", sub: `${lead.nome} · ${lead.subcategoria || lead.servico.split(" — ")[0]}${lead.total ? " · " + lead.total : ""}`, leadId: lead.id });

  const site = siteUrl(req);
  const details = rows([["Nome", lead.nome], ["WhatsApp", lead.telefone], ["Email", lead.email], ["Marca", lead.marca], ...(lead.categoria ? [["Categoria", lead.categoria], ["Subcategoria", lead.subcategoria]] : lead.plano ? [["Plano", lead.plano]] : [["Serviço", lead.servico]]), ["Extras", lead.extras],
    ["Total estimado", lead.total], ["Orçamento", lead.orcamento], ["Prazo", lead.prazo], ["Mensagem", lead.mensagem]]);
  const tasks = [];
  if (env("NOTIFY_EMAIL")) {
    tasks.push(sendMail({
      to: env("NOTIFY_EMAIL"), replyTo: lead.email || undefined,
      subject: `Novo pedido: ${lead.nome} · ${lead.subcategoria || lead.servico.split(" — ")[0]}${lead.total ? " · " + lead.total : ""}`,
      html: mailLayout("Novo pedido de orçamento", details + button(site + "/admin/", "Abrir o painel")),
      text: `Novo pedido de orçamento\n\n${lead.nome} (${[lead.telefone, lead.email].filter(Boolean).join(", ")})\n${lead.servico}\n${lead.total}${lead.orcamento ? "\nOrçamento: " + lead.orcamento : ""}${lead.prazo ? "\nPrazo: " + lead.prazo : ""}\n\n${lead.mensagem}\n\n${site}/admin/`
    }));
  }
  if (lead.email) {
    tasks.push(sendMail({
      to: lead.email,
      subject: "Recebi o teu pedido de orçamento",
      html: mailLayout("Pedido recebido", p(`Olá ${lead.nome.split(" ")[0]},`) +
        p("Obrigada pelo teu pedido. Vou analisar o teu projeto e entrar em contacto contigo" + (lead.telefone ? " pelo WhatsApp ou por email" : " por email") + ", em 24 a 48 horas, com os próximos passos.") + details),
      text: `Olá ${lead.nome.split(" ")[0]},\n\nObrigada pelo teu pedido. Vou analisar o teu projeto e entrar em contacto contigo${lead.telefone ? " pelo WhatsApp ou por email" : " por email"}, em 24 a 48 horas.\n\n${lead.servico}`
    }));
  }
  await Promise.allSettled(tasks);

  return json({ ok: true, id: lead.id });
};

export const config = { path: "/api/lead" };
