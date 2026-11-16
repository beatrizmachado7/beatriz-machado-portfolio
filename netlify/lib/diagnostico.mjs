// Diagnóstico Digital Gratuito: estados, validação do pedido, rascunho do relatório e PDF com a marca.
// Regra central: nenhum diagnóstico segue para o cliente sem aprovação da Beatriz (ver canSend).
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from "pdf-lib";
import { sha } from "./common.mjs";

export const DIAG_SERVICE = "Diagnóstico Digital Gratuito";

/* ---------- estados ---------- */
export const DIAG_STATES = {
  new: "Novo",
  in_review: "Em análise",
  draft_ready: "Rascunho pronto",
  approved: "Aprovado",
  delivered: "Entregue",
  proposal_requested: "Proposta pedida",
  converted: "Convertido",
  closed: "Fechado"
};
export const DIAG_OPEN = ["new", "in_review", "draft_ready", "approved", "delivered", "proposal_requested"];
// Estados que a Beatriz pode marcar à mão. «Aprovado» só pela ação de aprovar; «Entregue» à mão só depois de aprovado.
export function manualStatusError(diag, to) {
  if (!DIAG_STATES[to]) return "Estado desconhecido.";
  if (to === "approved") return "Para aprovar, usa o botão «Aprovar diagnóstico» (depois de leres o rascunho).";
  if (to === "draft_ready" && !diag.report) return "Ainda não há rascunho guardado.";
  if (to === "delivered" && !isApproved(diag) && diag.status !== "delivered") return "Só podes marcar como entregue um diagnóstico que já aprovaste.";
  return "";
}
export const isApproved = (diag) => !!(diag && diag.report && diag.approved && diag.approved.hash && diag.approved.hash === diag.reportHash);
export const canSend = (diag) => isApproved(diag) && (diag.status === "approved" || diag.status === "delivered");
export function logState(diag, to, by, extra) {
  return { ...diag, status: to, log: [...(diag.log || []), { at: new Date().toISOString(), to, by, ...(extra || {}) }].slice(-60) };
}

/* ---------- pedido vindo do site ---------- */
const cleanLine = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanText = (v, max) => String(v ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

// Aceita um website (com ou sem https://) ou um Instagram (@nome ou link). Devolve o endereço normalizado.
export function normalizePresence(raw) {
  let v = cleanLine(raw, 300);
  if (!v) return { error: "Indica o teu website ou o teu Instagram." };
  const handle = /^@?([A-Za-z0-9._]{2,30})$/.exec(v);
  if (v.startsWith("@") || (handle && !v.includes("."))) {
    if (!handle) return { error: "O Instagram não parece válido. Escreve, por exemplo, @onomedoteunegocio." };
    return { url: "https://www.instagram.com/" + handle[1].toLowerCase() + "/", kind: "instagram" };
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = "https://" + v;
  let u;
  try { u = new URL(v); } catch { return { error: "O endereço não parece válido. Escreve, por exemplo, omeunegocio.pt ou @omeunegocio." }; }
  const host = u.hostname.toLowerCase();
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host))
    return { error: "O endereço não parece válido. Escreve, por exemplo, omeunegocio.pt ou @omeunegocio." };
  u.hash = "";
  const kind = /(^|\.)instagram\.com$/.test(host) ? "instagram" : "website";
  if (kind === "instagram" && !/^\/[A-Za-z0-9._]{2,30}\/?$/.test(u.pathname)) return { error: "Indica o link do perfil de Instagram do teu negócio (ou escreve @onome)." };
  return { url: (kind === "instagram" ? "https://www.instagram.com" + u.pathname.toLowerCase().replace(/\/?$/, "/") : u.toString()).slice(0, 300), kind };
}

export function validateRequest(body, emailOk) {
  const errors = {};
  const nome = cleanLine(body.nome, 120), email = cleanLine(body.email, 200).toLowerCase(), marca = cleanLine(body.marca, 160), desafio = cleanText(body.desafio, 2000);
  if (nome.length < 2) errors.nome = "Escreve o teu nome.";
  if (!emailOk(email)) errors.email = "Escreve um email válido para eu te poder responder.";
  if (marca.length < 2) errors.marca = "Escreve o nome do teu negócio.";
  const pres = normalizePresence(body.url);
  if (pres.error) errors.url = pres.error;
  if (desafio.length < 10) errors.desafio = "Conta-me, em poucas palavras, o que gostavas de melhorar.";
  if (body.privacidade !== true) errors.privacidade = "Para enviar o pedido, confirma que leste a Política de Privacidade.";
  return { errors, ok: !Object.keys(errors).length, data: { nome, email, marca, desafio, url: pres.url || "", urlKind: pres.kind || "" } };
}
export const dupKey = (email, url) => "diagdup/" + sha(String(email).toLowerCase() + "|" + String(url).toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, ""));

/* ---------- rascunho do relatório (preparado com a Claude, revisto pela Beatriz) ---------- */
// Catálogo oficial do estúdio: só estes serviços podem ser recomendados num diagnóstico.
export const CATALOG = ["Landing Page", "Website Completo", "Loja Online", "Logótipo", "Identidade Visual Completa", "Rebranding", "Templates de Websites"];
const PRIO = { alta: "Alta", media: "Média", "média": "Média", baixa: "Baixa" };

export function normalizeReport(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const errs = [];
  const out = {
    introducao: cleanText(r.introducao, 900),
    presenca: cleanText(r.presenca, 1400),
    pontosFortes: (Array.isArray(r.pontosFortes) ? r.pontosFortes : []).map((x) => cleanLine(x, 220)).filter(Boolean).slice(0, 4),
    melhorias: (Array.isArray(r.melhorias) ? r.melhorias : []).slice(0, 3).map((m) => ({
      titulo: cleanLine(m && m.titulo, 110), observacao: cleanText(m && m.observacao, 600), importancia: cleanText(m && m.importancia, 500),
      acao: cleanText(m && m.acao, 500), prioridade: PRIO[String((m && m.prioridade) || "").toLowerCase()] || ""
    })),
    sugestaoVisual: null,
    proximosPassos: (Array.isArray(r.proximosPassos) ? r.proximosPassos : []).map((x) => cleanLine(x, 260)).filter(Boolean).slice(0, 5),
    servico: null,
    notaAmbito: cleanText(r.notaAmbito, 500),
    materiais: (Array.isArray(r.materiais) ? r.materiais : []).map((x) => cleanLine(x, 300)).filter(Boolean).slice(0, 12),
    email: { assunto: cleanLine(r.email && r.email.assunto, 160), texto: cleanText(r.email && r.email.texto, 3000) }
  };
  if (r.sugestaoVisual && (r.sugestaoVisual.titulo || r.sugestaoVisual.descricao))
    out.sugestaoVisual = { titulo: cleanLine(r.sugestaoVisual.titulo, 110), descricao: cleanText(r.sugestaoVisual.descricao, 700) };
  if (r.servico && r.servico.nome) {
    const nome = CATALOG.find((c) => c.toLowerCase() === cleanLine(r.servico.nome, 80).toLowerCase());
    if (!nome) errs.push("O serviço recomendado tem de ser um destes: " + CATALOG.join(", ") + ".");
    else out.servico = { nome, porque: cleanText(r.servico.porque, 600), preco: cleanLine(r.servico.preco, 60) };
  }
  if (!out.introducao) errs.push("Falta a introdução.");
  if (!out.presenca) errs.push("Falta a descrição da presença digital atual.");
  if (out.melhorias.length !== 3) errs.push("O diagnóstico tem de ter exatamente 3 melhorias prioritárias.");
  out.melhorias.forEach((m, i) => { if (!m.titulo || !m.observacao || !m.acao) errs.push("A melhoria " + (i + 1) + " precisa de título, observação e ação recomendada."); });
  if (!out.proximosPassos.length) errs.push("Faltam os próximos passos.");
  if (!out.materiais.length) errs.push("Indica em «materiais» o que foi realmente analisado (páginas, perfil, imagens).");
  if (!out.email.assunto || !out.email.texto) errs.push("Falta o email de entrega (assunto e texto).");
  return { report: out, errors: errs };
}
export const reportHash = (report) => sha(JSON.stringify(report));

/* ---------- PDF ---------- */
// Cores do Brandbook. Os tipos de letra padrão do PDF (Helvetica e Times Italic) fazem as vezes de Outfit/Inclusive Sans e Instrument Serif Italic.
const C = { bordo: rgb(53 / 255, 14 / 255, 23 / 255), deep: rgb(36 / 255, 9 / 255, 16 / 255), blush: rgb(240 / 255, 194 / 255, 174 / 255), rosa: rgb(246 / 255, 233 / 255, 230 / 255), pink: rgb(233 / 255, 211 / 255, 214 / 255),
  ink: rgb(42 / 255, 18 / 255, 22 / 255), mut: rgb(116 / 255, 84 / 255, 90 / 255), white: rgb(1, 1, 1) };
const safe = (t) => String(t ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/→/g, "->").replace(/[^\x20-\x7E\xA0-\xFF€—–…·•\n]/g, "");
export const longDate = (iso) => new Date(iso).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Lisbon" });

function wrap(font, text, size, max) {
  const out = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(t, size) > max && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

// lead: pedido · report: rascunho normalizado · opts: { date, draft, sig: {email, telefone, site, instagram}, site }
export async function diagPdf(lead, report, opts = {}) {
  const doc = await PDFDocument.create();
  const date = opts.date || new Date().toISOString();
  doc.setTitle("Diagnóstico Digital · " + safe(lead.marca || lead.nome) + " · Beatriz Studio"); doc.setAuthor("Beatriz Studio"); doc.setCreator("beatrizstudio.pt"); doc.setLanguage("pt-PT");
  const R = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold), I = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const W = 595.28, H = 841.89, M = 52, CW = W - 2 * M, FOOT = 74;
  let page, y;
  const newPage = () => { page = doc.addPage([W, H]); y = H - 64; };
  const need = (h) => { if (y - h < FOOT) newPage(); };
  const text = (t, x, yy, o = {}) => page.drawText(safe(t), { x, y: yy, size: o.size || 10, font: o.font || R, color: o.color || C.ink });
  const para = (t, o = {}) => {
    const size = o.size || 10.5, lh = o.lh || size * 1.5, font = o.font || R, x = o.x ?? M, max = o.max || CW - (x - M);
    for (const l of wrap(font, t, size, max)) { need(lh); if (l) text(l, x, y - size, { size, font, color: o.color || C.ink }); y -= lh; }
    y -= o.after ?? 8;
  };
  const section = (n, title) => {
    need(72); y -= 14;
    text(n, M, y - 9, { font: B, size: 8.5, color: C.mut });
    page.drawLine({ start: { x: M + 22, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.6, color: C.pink });
    y -= 22;
    text(title, M, y - 17, { font: I, size: 21, color: C.bordo }); y -= 36;
  };

  // capa: faixa bordô com a marca, o título e o negócio
  page = doc.addPage([W, H]);
  const HEAD = 250;
  page.drawRectangle({ x: 0, y: H - HEAD, width: W, height: HEAD, color: C.bordo });
  page.drawCircle({ x: W - 60, y: H - 40, size: 150, borderColor: C.deep, borderWidth: 34, opacity: 0, borderOpacity: 0.55 });
  text("beatriz studio", M, H - 62, { font: B, size: 18, color: C.white });
  page.drawCircle({ x: M + B.widthOfTextAtSize("beatriz studio", 18) + 4, y: H - 60.6, size: 2.1, color: C.blush });
  text("DIAGNÓSTICO DIGITAL PERSONALIZADO", M, H - 122, { font: B, size: 8.5, color: C.blush });
  const nameLines = wrap(I, lead.marca || lead.nome, 34, CW - 40).slice(0, 2);
  let ty = H - 162;
  nameLines.forEach((l) => { text(l, M, ty, { font: I, size: 34, color: C.white }); ty -= 38; });
  text(longDate(date) + "  ·  Preparado para " + safe(lead.nome), M, H - HEAD + 26, { size: 9.5, color: C.blush });
  y = H - HEAD - 34;

  para(report.introducao, { size: 11.5, lh: 18, after: 4 });

  section("01", "Presença digital atual");
  para(report.presenca);
  if (report.pontosFortes.length) {
    need(30); text("O QUE JÁ FUNCIONA", M, y - 8, { font: B, size: 7.5, color: C.mut }); y -= 20;
    report.pontosFortes.forEach((pf) => { need(16); page.drawCircle({ x: M + 3, y: y - 6.5, size: 2.2, color: C.blush }); para(pf, { x: M + 14, size: 10, after: 3 }); });
    y -= 4;
  }

  section("02", "Três melhorias prioritárias");
  report.melhorias.forEach((m, i) => {
    const rowsDef = [["O que observei", m.observacao], ["Porque importa", m.importancia], ["Como melhorar", m.acao]].filter((r) => r[1]);
    const inner = CW - 36, lines = rowsDef.map((r) => wrap(R, r[1], 10, inner));
    const titleLines = wrap(B, m.titulo, 12.5, inner - 70);
    const h = 24 + titleLines.length * 17 + lines.reduce((t, l) => t + 15 + l.length * 14.5 + 6, 0) + 10;
    need(Math.min(h, H - 64 - FOOT));
    const top = y;
    page.drawRectangle({ x: M, y: top - h, width: CW, height: h, color: C.rosa });
    page.drawRectangle({ x: M, y: top - h, width: 3, height: h, color: C.bordo });
    let yy = top - 24;
    text(String(i + 1).padStart(2, "0"), M + 18, yy, { font: I, size: 15, color: C.bordo });
    titleLines.forEach((l, k) => text(l, M + 44, yy - k * 17, { font: B, size: 12.5 }));
    if (m.prioridade) { const lab = "PRIORIDADE " + m.prioridade.toUpperCase(), lw = B.widthOfTextAtSize(safe(lab), 7); text(lab, W - M - 16 - lw, yy + 1, { font: B, size: 7, color: C.mut }); }
    yy -= titleLines.length * 17 + 6;
    rowsDef.forEach((r, k) => {
      text(r[0].toUpperCase(), M + 18, yy, { font: B, size: 7, color: C.mut }); yy -= 15;
      lines[k].forEach((l) => { text(l, M + 18, yy, { size: 10 }); yy -= 14.5; });
      yy -= 6;
    });
    y = top - h - 12;
  });

  let n = 3;
  if (report.sugestaoVisual) {
    section(String(n++).padStart(2, "0"), "Sugestão visual");
    if (report.sugestaoVisual.titulo) para(report.sugestaoVisual.titulo, { font: B, size: 11.5, after: 2 });
    para(report.sugestaoVisual.descricao);
  }

  section(String(n++).padStart(2, "0"), "Próximos passos");
  report.proximosPassos.forEach((s, i) => {
    need(22);
    page.drawCircle({ x: M + 8, y: y - 6, size: 8, color: C.bordo });
    const num = String(i + 1); text(num, M + 8 - B.widthOfTextAtSize(num, 8.5) / 2, y - 9, { font: B, size: 8.5, color: C.white });
    para(s, { x: M + 26, after: 6 });
  });

  if (report.servico) {
    section(String(n++).padStart(2, "0"), "Uma solução possível");
    para(report.servico.nome + (report.servico.preco ? "  ·  " + report.servico.preco : ""), { font: B, size: 12, after: 3 });
    if (report.servico.porque) para(report.servico.porque);
    para("Esta sugestão é opcional. O diagnóstico é teu e podes aplicar as recomendações da forma que fizer mais sentido para ti.", { size: 9, color: C.mut });
  }
  if (report.notaAmbito) { need(40); para("Nota de âmbito: " + report.notaAmbito, { size: 9, color: C.mut }); }

  // contacto e convite, sem pressão
  const sig = opts.sig || {}, site = String(opts.site || "https://beatrizstudio.pt").replace(/\/$/, ""), url = site + "/contacto/";
  need(104); y -= 10;
  page.drawRectangle({ x: M, y: y - 84, width: CW, height: 84, color: C.bordo });
  text("Queres conversar sobre isto?", M + 20, y - 30, { font: I, size: 19, color: C.white });
  text("Se fizer sentido para ti, responde ao email ou fala comigo. Sem compromisso.", M + 20, y - 49, { size: 9.5, color: C.blush });
  text([sig.email, sig.telefone, url.replace(/^https?:\/\//, "")].filter(Boolean).join("  ·  "), M + 20, y - 67, { font: B, size: 9, color: C.white });
  const annot = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [M, y - 84, W - M, y], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
  page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annot)]));
  y -= 96;

  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.6, color: C.pink });
    pg.drawText(safe("Beatriz Studio · beatrizstudio.pt"), { x: M, y: 34, size: 8.5, font: B, color: C.ink });
    const t = safe([sig.email, sig.instagram].filter(Boolean).join(" · ") + (pages.length > 1 ? "  ·  " + (i + 1) + "/" + pages.length : ""));
    pg.drawText(t, { x: W - M - R.widthOfTextAtSize(t, 8.5), y: 34, size: 8.5, font: R, color: C.mut });
    if (opts.draft) pg.drawText("RASCUNHO · NÃO ENVIAR", { x: 70, y: 250, size: 44, font: B, color: C.bordo, opacity: 0.08, rotate: { type: "degrees", angle: 45 } });
  });
  return await doc.save();
}
