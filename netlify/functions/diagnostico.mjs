// Recebe os pedidos de «Diagnóstico Digital Gratuito» (página /diagnostico-digital/).
// Guarda o pedido junto dos outros pedidos do painel (Netlify Blobs), com o estado do diagnóstico «Novo»,
// avisa a Beatriz (sino + email) e confirma a receção ao cliente por email.
// Só responde com sucesso depois de o pedido estar mesmo guardado. Não inscreve ninguém em listas de marketing.
import { json, store, limited, notify, sendMail, mailReady, mailLayout, p, pH, rows, button, env, siteUrl, emailOk, ip, getSignature, signatureText } from "../lib/common.mjs";
import { DIAG_SERVICE, DIAG_OPEN, validateRequest, dupKey } from "../lib/diagnostico.mjs";

const GENERIC = "Não foi possível enviar o pedido. Tenta outra vez daqui a pouco ou escreve-me para beatrizmachadostudio@gmail.com.";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!/application\/json/i.test(req.headers.get("content-type") || "")) return json({ error: "Pedido inválido" }, 415);
  let raw;
  try { raw = await req.text(); } catch { return json({ error: "Pedido inválido" }, 400); }
  if (raw.length > 12000) return json({ error: "Pedido demasiado grande." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Pedido inválido" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Pedido inválido" }, 400);

  // anti-spam invisível: campo armadilha e tempo mínimo de preenchimento (nunca devolve um falso «recebido»)
  if (body["bot-field"]) return json({ error: GENERIC }, 400);
  if (!(Number(body.t) >= 3000)) return json({ error: "Foi rápido demais. Confirma os dados e envia outra vez." }, 400);

  const v = validateRequest(body, emailOk);
  if (!v.ok) return json({ error: "Há campos por corrigir.", fields: v.errors }, 400);
  const d = v.data;

  const s = store();
  try { await s.get("health"); } catch (e) { console.error("diagnostico: base de dados", e); return json({ error: GENERIC }, 503); }
  if (await limited(s, "diag-ip:" + ip(req), 5, 36e5)) return json({ error: "Recebi vários pedidos seguidos deste dispositivo. Tenta mais tarde ou escreve-me por email." }, 429);
  if (await limited(s, "diag-mail:" + d.email, 4, 24 * 36e5)) return json({ error: "Já recebi vários pedidos com este email hoje. Se precisares de acrescentar alguma coisa, responde ao email de confirmação." }, 429);

  // sem duplicados: o mesmo email + a mesma presença digital só criam um pedido enquanto o anterior estiver aberto
  const dk = dupKey(d.email, d.url);
  const prevRef = await s.get(dk, { type: "json" });
  if (prevRef) {
    const prev = await s.get("leads/" + prevRef.id, { type: "json" });
    if (prev && prev.diag && DIAG_OPEN.includes(prev.diag.status)) return json({ ok: true, duplicate: true, id: prev.id });
  }

  const now = new Date().toISOString();
  const lead = {
    id: crypto.randomUUID(), createdAt: now, type: "diagnostico", userId: "",
    nome: d.nome, email: d.email, telefone: "", marca: d.marca,
    categoria: "", subcategoria: "", plano: "", servico: DIAG_SERVICE, extras: "", total: "", orcamento: "", prazo: "",
    mensagem: d.desafio, url: d.url, urlKind: d.urlKind,
    status: "novo", notes: "", history: [],
    diag: { status: "new", log: [{ at: now, to: "new", by: "site" }] },
    // base legal: diligências pré-contratuais a pedido da própria pessoa; sem inscrição em marketing
    consent: { privacyNotice: true, at: now, marketing: false }
  };

  try {
    // reserva atómica da chave de duplicado (dois envios em simultâneo só criam um pedido)
    const claim = await s.setJSON(dk, { id: lead.id, at: now }, prevRef ? undefined : { onlyIfNew: true });
    if (claim && claim.modified === false) {
      const other = await s.get(dk, { type: "json" });
      return json({ ok: true, duplicate: true, id: (other && other.id) || "" });
    }
    await s.setJSON("leads/" + lead.id, lead);
    const check = await s.get("leads/" + lead.id, { type: "json" });
    if (!check || check.id !== lead.id) throw new Error("pedido não confirmado na base de dados");
  } catch (e) {
    console.error("diagnostico: guardar", e);
    try { await s.delete(dk); } catch {}
    return json({ error: GENERIC }, 500);
  }

  // A partir daqui o pedido está guardado: avisos e emails nunca anulam o sucesso, mas o resultado fica registado.
  const mail = { ack: "skipped", admin: "skipped" };
  try { await notify(s, { type: "lead", title: "Novo pedido de diagnóstico digital", sub: `${lead.nome} · ${lead.marca}`, leadId: lead.id }); } catch (e) { console.error("diagnostico: notificação", e); }
  if (mailReady()) {
    const site = siteUrl(req), first = lead.nome.split(" ")[0];
    const details = rows([["Nome", lead.nome], ["Email", lead.email], ["Negócio", lead.marca], [lead.urlKind === "instagram" ? "Instagram" : "Website", lead.url], ["Objetivo", lead.mensagem]]);
    const sig = await getSignature(s);
    const tasks = [sendMail({
      to: lead.email,
      subject: "Recebi o teu pedido de diagnóstico digital",
      html: mailLayout("Pedido recebido", p(`Olá ${first},`) +
        p("Obrigada pelo interesse. Recebi o teu pedido de Diagnóstico Digital Gratuito para " + lead.marca + ".") +
        pH("<b>O que acontece agora:</b> vou analisar a tua presença online e as informações que enviaste, e depois entro em contacto contigo por email com as minhas recomendações.") +
        p("O diagnóstico é gratuito e não te compromete a nada. Se quiseres acrescentar alguma informação, basta responderes a este email.") + details, sig),
      text: `Olá ${first},\n\nObrigada pelo interesse. Recebi o teu pedido de Diagnóstico Digital Gratuito para ${lead.marca}.\n\nVou analisar a tua presença online e as informações que enviaste, e depois entro em contacto contigo por email com as minhas recomendações.\n\nO diagnóstico é gratuito e não te compromete a nada. Se quiseres acrescentar alguma informação, basta responderes a este email.\n\n${lead.url}` + signatureText(sig)
    }).then((r) => { mail.ack = r.ok ? "sent" : "failed"; })];
    if (env("NOTIFY_EMAIL")) tasks.push(sendMail({
      to: env("NOTIFY_EMAIL"), replyTo: lead.email,
      subject: `Novo diagnóstico digital: ${lead.nome} · ${lead.marca}`,
      html: mailLayout("Novo pedido de diagnóstico digital", details + button(site + "/admin/", "Abrir o painel")),
      text: `Novo pedido de diagnóstico digital\n\n${lead.nome} (${lead.email})\nNegócio: ${lead.marca}\n${lead.url}\n\n${lead.mensagem}\n\n${site}/admin/`
    }).then((r) => { mail.admin = r.ok ? "sent" : "failed"; }));
    await Promise.allSettled(tasks);
  }
  try {
    lead.mail = { ...mail, at: new Date().toISOString() };
    if (mail.ack === "sent") lead.history.push({ at: lead.mail.at, via: "email", by: "Envio automático", subject: "Recebi o teu pedido de diagnóstico digital", text: "Confirmação de receção enviada automaticamente ao cliente." });
    await s.setJSON("leads/" + lead.id, lead);
  } catch (e) { console.error("diagnostico: registo dos emails", e); }

  return json({ ok: true, id: lead.id, mail: { ack: mail.ack } });
};

export const config = { path: "/api/diagnostico" };
