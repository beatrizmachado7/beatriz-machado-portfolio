// Recebe os pedidos de orçamento do site (com ou sem conta) e guarda-os na base de dados (Netlify Blobs).
// Proteção anti-spam invisível: campo armadilha, tempo mínimo de preenchimento e limite por IP.
// Cria uma notificação no painel e envia um email à Beatriz (e ao cliente, se deixou email).
import { json, clean, store, sessionUser, limited, notify, sendMail, mailLayout, p, rows, button, env, siteUrl, emailOk, phoneOk, ip } from "../lib/common.mjs";

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
  if (!phoneOk(lead.telefone)) return json({ error: "Escreve um número de WhatsApp válido." }, 400);
  if (lead.email && !emailOk(lead.email)) return json({ error: "O email não parece válido." }, 400);
  if (!lead.servico) return json({ error: "Escolhe o serviço que procuras." }, 400);

  await s.setJSON("leads/" + lead.id, lead);
  if (u) await s.setJSON("uleads/" + u.id + "/" + lead.id, { at: lead.createdAt });
  await notify(s, { type: "lead", title: "Novo pedido de orçamento", sub: `${lead.nome} · ${lead.servico.split(" — ")[0]}${lead.total ? " · " + lead.total : ""}`, leadId: lead.id });

  const site = siteUrl(req);
  const details = rows([["Nome", lead.nome], ["WhatsApp", lead.telefone], ["Email", lead.email], ["Marca", lead.marca], ["Serviço", lead.servico], ["Extras", lead.extras],
    ["Total estimado", lead.total], ["Orçamento", lead.orcamento], ["Prazo", lead.prazo], ["Mensagem", lead.mensagem]]);
  const tasks = [];
  if (env("NOTIFY_EMAIL")) {
    tasks.push(sendMail({
      to: env("NOTIFY_EMAIL"), replyTo: lead.email || undefined,
      subject: `Novo pedido: ${lead.nome} · ${lead.servico.split(" — ")[0]}${lead.total ? " · " + lead.total : ""}`,
      html: mailLayout("Novo pedido de orçamento", details + button(site + "/admin/", "Abrir o painel")),
      text: `Novo pedido de orçamento\n\n${lead.nome} (${lead.telefone}${lead.email ? ", " + lead.email : ""})\n${lead.servico}\n${lead.total}\nOrçamento: ${lead.orcamento}\nPrazo: ${lead.prazo}\n\n${lead.mensagem}\n\n${site}/admin/`
    }));
  }
  if (lead.email) {
    tasks.push(sendMail({
      to: lead.email,
      subject: "Recebi o teu pedido de orçamento",
      html: mailLayout("Pedido recebido", p(`Olá ${lead.nome.split(" ")[0]},`) +
        p("Obrigada pelo teu pedido. Vou analisar o teu projeto e entrar em contacto contigo pelo WhatsApp, em 24 a 48 horas, com os próximos passos.") + details),
      text: `Olá ${lead.nome.split(" ")[0]},\n\nObrigada pelo teu pedido. Vou analisar o teu projeto e entrar em contacto contigo pelo WhatsApp, em 24 a 48 horas.\n\n${lead.servico}\n${lead.total}`
    }));
  }
  await Promise.allSettled(tasks);

  return json({ ok: true, id: lead.id });
};

export const config = { path: "/api/lead" };
