// Diagnóstico Digital Gratuito: estados, validação do pedido, rascunho do relatório e PDF com a marca.
// Regra central: nenhum diagnóstico segue para o cliente sem aprovação da Beatriz (ver canSend).
import { PDFDocument, rgb, degrees, PDFName, PDFString, pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clip, endPath } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { OUTFIT_400, OUTFIT_600, INCLUSIVE_400, INCLUSIVE_600, ISERIF_ITALIC, LOGO_LIGHT, LOGO_DARK } from "./diag-assets.mjs";
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
// Relatório com a identidade do estúdio: Outfit (títulos), Inclusive Sans (texto) e Instrument Serif Italic (acentos),
// cores do Brandbook, logótipo, retrato e, quando existirem, a captura da presença atual e a imagem da sugestão visual.
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = { bordo: hex("#350E17"), deep: hex("#240910"), white: hex("#FFFFFF"), rosa: hex("#F6E9E6"), blush: hex("#F0C2AE"), pink: hex("#E9D3D6"), ink: hex("#2A1216"), mut: hex("#74545A") };
export const longDate = (iso) => new Date(iso).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Lisbon" });
const ICON = {
  eye: "M2 12C4.4 7.8 7.9 5.5 12 5.5S19.6 7.8 22 12C19.6 16.2 16.1 18.5 12 18.5S4.4 16.2 2 12Z M12 9C10.3 9 9 10.3 9 12S10.3 15 12 15S15 13.7 15 12S13.7 9 12 9Z",
  spark: "M12 3L13.9 9.1L20 11L13.9 12.9L12 19L10.1 12.9L4 11L10.1 9.1Z",
  arrow: "M6 18L18 6M9.5 6H18V14.5",
  check: "M5 12.5L9.5 17L19 7.5"
};

// lead: pedido · report: rascunho normalizado
// opts: { date, draft, sig: {email, telefone, site, instagram}, site, images: { captura: {bytes, mime}, sugestao: {bytes, mime} } }
export async function diagPdf(lead, report, opts = {}) {
  let best = null;
  for (const k of [1, 0.75, 0.5]) {
    const r = await composeDiag(lead, report, opts, k);
    if (!best || r.pages < best.pages) best = r;
    if (r.pages <= 2 || r.lastFill >= 0.3) return r.bytes;
  }
  return best.bytes;
}
// k: fator dos espaços entre blocos (1 = normal; menos = mais compacto)
async function composeDiag(lead, report, opts, k) {
  const G = (v) => v * k;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const date = opts.date || new Date().toISOString();
  const brand = String(lead.marca || lead.nome || "");
  doc.setTitle("Diagnóstico Digital · " + brand + " · Beatriz Studio"); doc.setAuthor("Beatriz Studio"); doc.setCreator("beatrizstudio.pt"); doc.setLanguage("pt-PT");
  const emb = (bytes) => doc.embedFont(bytes, { subset: true });
  const [O4, O6, S4, S6, IT] = await Promise.all([emb(OUTFIT_400()), emb(OUTFIT_600()), emb(INCLUSIVE_400()), emb(INCLUSIVE_600()), emb(ISERIF_ITALIC())]);
  const [logoL, logoD] = await Promise.all([doc.embedPng(LOGO_LIGHT()), doc.embedPng(LOGO_DARK())]);
  const embedImg = async (im) => { if (!im || !im.bytes) return null; try { return im.mime === "image/png" ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes); } catch (e) { console.error("diagPdf: imagem", e); return null; } };
  const imgs = opts.images || {}, shot = await embedImg(imgs.captura), mock = await embedImg(imgs.sugestao);

  // texto: só caracteres que o tipo de letra tem (o resto é trocado ou retirado, para nunca aparecerem quadrados)
  const sets = new Map();
  const has = (font, ch) => { let st = sets.get(font); if (!st) { st = new Set(font.getCharacterSet()); sets.set(font, st); } return st.has(ch.codePointAt(0)); };
  const tidy = (font, t) => { let o = ""; for (const ch of String(t ?? "").replace(/­/g, "").replace(/[→➔➜]/g, "->").replace(/[‘’]/g, "'").replace(/[\t ]/g, " ")) { if (ch === "\n" || has(font, ch)) o += ch; else if (ch === "“" || ch === "”") o += '"'; else if (ch === "–" || ch === "—") o += "-"; else if (ch === "…") o += "..."; } return o; };
  const width = (font, t, size) => font.widthOfTextAtSize(t, size);
  function wrap(font, text, size, max) {
    const out = [];
    for (const para of tidy(font, text).split("\n")) {
      let line = "";
      for (let w of para.split(/ +/).filter(Boolean)) {
        // palavras maiores do que a linha (links longos) são partidas em vez de saírem da página
        while (width(font, w, size) > max) { let k = w.length - 1; while (k > 1 && width(font, w.slice(0, k), size) > max - (line ? width(font, line + " ", size) : 0)) k--; if (k <= 1 && line) { out.push(line); line = ""; continue; } out.push((line ? line + " " : "") + w.slice(0, k)); line = ""; w = w.slice(k); }
        const t = line ? line + " " + w : w;
        if (width(font, t, size) > max && line) { out.push(line); line = w; } else line = t;
      }
      out.push(line);
    }
    while (out.length && !out[out.length - 1]) out.pop();
    return out;
  }

  const W = 595.28, H = 841.89, M = 50, CW = W - 2 * M, TOP = H - 74, BOTTOM = 56 - (1 - k) * 12;
  let page, y;
  const text = (t, x, yy, o = {}) => { const f = o.font || S4; page.drawText(tidy(f, t).replace(/\n/g, " "), { x, y: yy, size: o.size || 10, font: f, color: o.color || C.ink, opacity: o.opacity }); };
  const rrect = (x, top, w, h, r, o = {}) => { r = Math.min(r, w / 2, h / 2); page.drawSvgPath(`M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`, { x, y: top, color: o.color, borderColor: o.borderColor, borderWidth: o.borderWidth, opacity: o.opacity, borderOpacity: o.borderOpacity }); };
  const icon = (name, x, top, size, color, bw = 1.5) => page.drawSvgPath(ICON[name], { x, y: top, scale: size / 24, borderColor: color, borderWidth: bw * 24 / size * (size / 24) });
  // imagem recortada a um retângulo (enche a largura e alinha pelo topo)
  const imageIn = (img, x, top, w, h) => {
    const sc = w / img.width, iw = w, ih = img.height * sc;
    page.pushOperators(pushGraphicsState(), moveTo(x, top), lineTo(x + w, top), lineTo(x + w, top - h), lineTo(x, top - h), closePath(), clip(), endPath());
    page.drawImage(img, { x, y: top - ih, width: iw, height: ih });
    page.pushOperators(popGraphicsState());
  };
  // moldura de janela de browser à volta de uma imagem
  const browserFrame = (img, x, top, w, h, label, dark) => {
    const bar = 20;
    rrect(x, top, w, h, 9, { color: dark ? C.deep : C.rosa });
    imageIn(img, x + 1, top - bar, w - 2, h - bar - 1);
    [0, 1, 2].forEach((i) => page.drawCircle({ x: x + 13 + i * 9, y: top - bar / 2, size: 2.4, color: dark ? C.bordo : C.pink, borderColor: dark ? C.blush : C.mut, borderWidth: 0.4, borderOpacity: 0.6 }));
    if (label) { const l = wrap(S4, label, 7, w - 90)[0] || ""; text(l, x + 46, top - bar / 2 - 2.5, { size: 7, color: dark ? C.blush : C.mut }); }
    rrect(x, top, w, h, 9, { borderColor: dark ? C.blush : C.pink, borderWidth: 0.7, borderOpacity: dark ? 0.45 : 1 });
  };

  /* ---------- capa ---------- */
  page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.bordo });
  [[W - 30, H - 120, 250, 0.16], [W - 30, H - 120, 180, 0.12], [W - 30, H - 120, 110, 0.1]].forEach(([cx, cy, r, op]) => page.drawCircle({ x: cx, y: cy, size: r, borderColor: C.blush, borderWidth: 0.8, borderOpacity: op, opacity: 0 }));
  page.drawImage(logoL, { x: M, y: H - 78, width: 150, height: 150 * logoL.height / logoL.width });
  const cy0 = shot ? H - 190 : H - 300;
  text("DIAGNÓSTICO DIGITAL PERSONALIZADO", M, cy0, { font: S6, size: 8.5, color: C.blush });
  page.drawLine({ start: { x: M, y: cy0 - 14 }, end: { x: M + 36, y: cy0 - 14 }, thickness: 1.2, color: C.blush });
  let nsz = 50, nl = wrap(IT, brand, nsz, CW - 30);
  if (nl.length > 2) { nsz = 38; nl = wrap(IT, brand, nsz, CW - 30).slice(0, 3); }
  let ty = cy0 - 30 - nsz * 0.82;
  nl.forEach((l) => { text(l, M, ty, { font: IT, size: nsz, color: C.white }); ty -= nsz * 1.04; });
  ty -= 2;
  text("Preparado para " + lead.nome, M, ty, { font: O4, size: 13, color: C.white }); ty -= 18;
  text(longDate(date), M, ty, { size: 10, color: C.blush });
  if (shot) {
    const top = Math.min(ty - 44, 470);
    const full = (CW - 2) * shot.height / shot.width + 21, bleed = full > top - 70;
    browserFrame(shot, M, top, CW, bleed ? top + 40 : full, String(lead.url || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), true);
    if (!bleed) { text("beatrizstudio.pt", M, 44, { font: S6, size: 9, color: C.white }); const tg = "Websites · Identidade Visual"; text(tg, W - M - width(S4, tg, 9), 44, { size: 9, color: C.blush }); }
  } else {
    let iy = 250;
    text("NESTE DOCUMENTO", M, iy, { font: S6, size: 7.5, color: C.blush }); iy -= 14;
    ["Presença digital atual", "Três melhorias prioritárias", "Próximos passos"].forEach((t, i) => {
      page.drawLine({ start: { x: M, y: iy }, end: { x: W - M, y: iy }, thickness: 0.6, color: C.blush, opacity: 0.3 });
      text(String(i + 1).padStart(2, "0"), M, iy - 30, { font: IT, size: 22, color: C.blush });
      text(t, M + 44, iy - 28, { font: O4, size: 15, color: C.white }); iy -= 46;
    });
    page.drawLine({ start: { x: M, y: iy }, end: { x: W - M, y: iy }, thickness: 0.6, color: C.blush, opacity: 0.3 });
    text("beatrizstudio.pt", M, 44, { font: S6, size: 9, color: C.white });
    const tg = "Websites · Identidade Visual"; text(tg, W - M - width(S4, tg, 9), 44, { size: 9, color: C.blush });
  }

  /* ---------- páginas interiores ---------- */
  const newPage = () => { page = doc.addPage([W, H]); y = TOP; };
  const need = (h) => { if (y - h < BOTTOM) newPage(); };
  const para = (t, o = {}) => {
    const size = o.size || 10, lh = o.lh || size * 1.5, font = o.font || S4, x = o.x ?? M, max = o.max || CW - (x - M);
    const lines = wrap(font, t, size, max);
    lines.forEach((l, i) => {
      // nunca deixa uma única linha sozinha no fim ou no início de uma página
      const left = lines.length - i;
      if (y - lh < BOTTOM || (left === 2 && lines.length > 2 && y - 2 * lh < BOTTOM)) newPage();
      if (l) text(l, x, y - size * 0.82, { size, font, color: o.color || C.ink });
      y -= lh;
    });
    y -= G(o.after ?? 6);
  };
  const label = (t, x, yy, color) => text(t.toUpperCase(), x, yy, { font: S6, size: 7.2, color: color || C.mut });
  let secN = 0;
  // título de secção: número em itálico + título em Outfit com a última parte em Instrument Serif Italic
  const section = (plain, accent, minAfter = 70) => {
    need(G(49) + minAfter); if (y < TOP) y -= G(6);
    secN++;
    text(String(secN).padStart(2, "0"), M, y - 9, { font: IT, size: 13, color: C.bordo });
    page.drawLine({ start: { x: M + 22, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.7, color: C.pink });
    y -= 10 + G(6);
    const p1 = tidy(O4, plain + " "), w1 = width(O4, p1, 17);
    text(p1, M, y - 15, { font: O4, size: 17, color: C.ink });
    text(accent, M + w1, y - 15, { font: IT, size: 19.5, color: C.bordo });
    y -= 20 + G(7);
  };

  newPage();
  // introdução em destaque
  para(report.introducao, { font: O4, size: 11.5, lh: 17.5, after: 2 });

  section("Presença digital", "atual.");
  para(report.presenca);
  if (report.pontosFortes.length) {
    const inner = CW - 56, L = report.pontosFortes.map((t) => wrap(S4, t, 9.5, inner));
    const h = 28 + L.reduce((t, l) => t + l.length * 13.5 + 4, 0) + 6;
    need(h + 6); y -= 2;
    rrect(M, y, CW, h, 10, { color: C.rosa });
    label("O que já funciona", M + 16, y - 18, C.bordo);
    let yy = y - 34;
    L.forEach((lines) => {
      page.drawCircle({ x: M + 22, y: yy + 3.2, size: 6, color: C.blush });
      icon("check", M + 17.4, yy + 7.8, 9.2, C.bordo, 1.3);
      lines.forEach((l) => { text(l, M + 36, yy, { size: 9.5 }); yy -= 13.5; });
      yy -= 4;
    });
    y -= h + G(7);
  }
  if (report.materiais.length) {
    const L = wrap(S4, "Analisei: " + report.materiais.join("  ·  "), 8, CW);
    need(L.length * 11 + 4);
    L.forEach((l) => { text(l, M, y - 7, { size: 8, color: C.mut }); y -= 11; });
    y -= 4;
  }

  const PR = { Alta: [C.bordo, C.white], "Média": [C.blush, C.deep], Baixa: [C.pink, C.deep] };
  const cards = report.melhorias.map((m) => {
    const X = M + 46, inner = W - M - 16 - X;
    const rowsDef = [["eye", "O que observei", m.observacao], ["spark", "Porque importa", m.importancia], ["arrow", "Como melhorar", m.acao]].filter((r) => r[2]);
    const lines = rowsDef.map((r) => wrap(S4, r[2], 9.5, inner - 96));
    const pill = m.prioridade ? "PRIORIDADE " + m.prioridade.toUpperCase() : "", pw = pill ? width(S6, tidy(S6, pill), 6.2) + 14 : 0;
    const tl = wrap(O6, m.titulo, 12.5, inner - pw - 10);
    const h = 15 + tl.length * 16 + 5 + lines.reduce((t, l) => t + l.length * 13.5 + G(4), 0) + 5;
    return { m, X, inner, rowsDef, lines, pill, pw, tl, h };
  });
  section("Três melhorias", "prioritárias.", Math.min(cards[0].h + G(6), TOP - BOTTOM - 60));
  cards.forEach(({ m, X, rowsDef, lines, pill, pw, tl, h }, i) => {
    need(Math.min(h + G(6), TOP - BOTTOM));
    const top = y;
    rrect(M, top, CW, h, 12, { color: C.rosa });
    text(String(i + 1).padStart(2, "0"), M + 14, top - 33, { font: IT, size: 26, color: C.bordo });
    let yy = top - 26;
    tl.forEach((l) => { text(l, X, yy, { font: O6, size: 12.5 }); yy -= 16; });
    if (pill) { const col = PR[m.prioridade] || PR.Baixa; rrect(W - M - 14 - pw, top - 15, pw, 14, 7, { color: col[0] }); text(pill, W - M - 14 - pw + 7, top - 24.3, { font: S6, size: 6.2, color: col[1] }); }
    yy -= 5;
    // etiqueta à esquerda e texto à direita, na mesma linha
    rowsDef.forEach((r, k) => {
      icon(r[0], X, yy + 8.6, 9.5, C.bordo, 1.2);
      label(r[1], X + 15, yy + 0.4, C.bordo);
      lines[k].forEach((l) => { text(l, X + 96, yy, { size: 9.5 }); yy -= 13.5; });
      yy -= G(4);
    });
    y = top - h - G(6);
  });

  if (report.sugestaoVisual) {
    const sv = report.sugestaoVisual;
    if (mock) {
      const iw = CW * 0.47, ih = Math.min(175, (iw - 2) * mock.height / mock.width + 21), tw = CW - iw - 18;
      const tl = sv.titulo ? wrap(O6, sv.titulo, 11, tw) : [], dl = sv.descricao ? wrap(S4, sv.descricao, 10, tw) : [];
      const th = tl.length * 15 + (tl.length ? 3 : 0) + dl.length * 15, bh = Math.max(ih + 13, th);
      section("Sugestão", "visual.", bh);
      need(bh);
      let yy = y - 9;
      tl.forEach((l) => { text(l, M, yy, { font: O6, size: 11 }); yy -= 15; });
      if (tl.length) yy -= 3;
      dl.forEach((l) => { text(l, M, yy, { size: 10 }); yy -= 15; });
      browserFrame(mock, W - M - iw, y, iw, ih, "Exemplo ilustrativo", false);
      text("Exemplo ilustrativo. Não representa um projeto final.", W - M - iw, y - ih - 9, { size: 7, color: C.mut });
      y -= bh + G(8);
    } else {
      section("Sugestão", "visual.", 40);
      if (sv.titulo) para(sv.titulo, { font: O6, size: 11, after: 1 });
      if (sv.descricao) para(sv.descricao);
    }
  }

  section("Próximos", "passos.", 50);
  report.proximosPassos.forEach((s, i) => {
    const lines = wrap(S4, s, 10, CW - 34), h = Math.max(20 + G(4), lines.length * 14 + 5 + G(4));
    need(h);
    if (i < report.proximosPassos.length - 1) page.drawLine({ start: { x: M + 9, y: y - 18 }, end: { x: M + 9, y: y - h - 1 }, thickness: 0.8, color: C.pink });
    page.drawCircle({ x: M + 9, y: y - 9, size: 9, color: C.bordo });
    const num = String(i + 1); text(num, M + 9 - width(O6, num, 8.5) / 2, y - 12, { font: O6, size: 8.5, color: C.white });
    let yy = y - 12.4; lines.forEach((l) => { text(l, M + 28, yy, { size: 10 }); yy -= 14; });
    y -= h;
  });
  y -= 2;

  if (report.servico) {
    const sv = report.servico, wl = sv.porque ? wrap(S4, sv.porque, 9.5, CW - 36) : [];
    const note = wrap(S4, "Sugestão opcional: podes aplicar as recomendações da forma que fizer mais sentido para ti.", 8, CW - 36);
    const h = 48 + wl.length * 13.5 + (wl.length ? 6 : 0) + note.length * 11 + 10;
    need(h + G(14)); y -= G(8);
    const top = y;
    rrect(M, top, CW, h, 12, { color: C.bordo });
    label("Uma solução possível", M + 18, top - 19, C.blush);
    text(sv.nome, M + 18, top - 38, { font: O6, size: 15, color: C.white });
    if (sv.preco) { const pt = tidy(S6, sv.preco), pw = width(S6, pt, 9.5) + 20; rrect(W - M - 18 - pw, top - 20, pw, 22, 11, { color: C.blush }); text(pt, W - M - 18 - pw + 10, top - 34.4, { font: S6, size: 9.5, color: C.deep }); }
    let yy = top - 56;
    wl.forEach((l) => { text(l, M + 18, yy, { size: 9.5, color: C.white }); yy -= 13.5; });
    if (wl.length) yy -= 6;
    note.forEach((l) => { text(l, M + 18, yy, { size: 8, color: C.pink }); yy -= 11; });
    y = top - h - G(10);
  }
  if (report.notaAmbito) { const L = wrap(S4, "Nota de âmbito: " + report.notaAmbito, 8, CW); need(L.length * 11 + 4); L.forEach((l) => { text(l, M, y - 7, { size: 8, color: C.mut }); y -= 11; }); y -= 4; }

  // fecho: convite sem pressão, com o retrato e os contactos
  const sig = opts.sig || {}, site = String(opts.site || "https://beatrizstudio.pt").replace(/\/$/, ""), url = site + "/contacto/";
  const CH = 78;
  need(CH + G(6)); y -= G(6);
  const ctop = y, lw = 104, lh = lw * logoD.height / logoD.width;
  rrect(M, ctop, CW, CH, 14, { color: C.rosa });
  page.drawImage(logoD, { x: M + 20, y: ctop - CH / 2 - lh / 2, width: lw, height: lh });
  page.drawLine({ start: { x: M + 142, y: ctop - 16 }, end: { x: M + 142, y: ctop - CH + 16 }, thickness: 0.8, color: C.blush });
  const cx = M + 160;
  text("Queres conversar sobre isto?", cx, ctop - 29, { font: IT, size: 18, color: C.bordo });
  text("Responde ao email ou fala comigo. Sem compromisso.", cx, ctop - 45, { size: 9.5 });
  const contacts = [sig.email, sig.telefone && "WhatsApp " + sig.telefone, url.replace(/^https?:\/\//, "")].filter(Boolean);
  let fs = 8.2; while (fs > 6 && width(S6, tidy(S6, contacts.join("  ·  ")), fs) > W - M - 16 - cx) fs -= 0.2;
  text(contacts.join("  ·  "), cx, ctop - 62, { font: S6, size: fs, color: C.bordo });
  const annot = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [M, ctop - CH, W - M, ctop], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
  page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annot)]));
  y = ctop - CH - 10;

  // cabeçalho e rodapé das páginas interiores; marca de rascunho em todas
  const pages = doc.getPages();
  const headR = tidy(S4, "Diagnóstico Digital  ·  " + (wrap(S4, brand, 8, 240)[0] || ""));
  pages.forEach((pg, i) => {
    if (i > 0) {
      pg.drawImage(logoD, { x: M, y: H - 49, width: 86, height: 86 * logoD.height / logoD.width });
      pg.drawText(headR, { x: W - M - width(S4, headR, 8), y: H - 45, size: 8, font: S4, color: C.mut });
      pg.drawLine({ start: { x: M, y: H - 58 }, end: { x: W - M, y: H - 58 }, thickness: 0.6, color: C.pink });
      pg.drawLine({ start: { x: M, y: 44 }, end: { x: W - M, y: 44 }, thickness: 0.6, color: C.pink });
      pg.drawText("beatrizstudio.pt", { x: M, y: 30, size: 8, font: S6, color: C.bordo });
      const n = String(i + 1).padStart(2, "0") + " / " + String(pages.length).padStart(2, "0");
      pg.drawText(n, { x: W - M - width(S4, n, 8), y: 30, size: 8, font: S4, color: C.mut });
    }
    if (opts.draft) pg.drawText("RASCUNHO", { x: 120, y: 250, size: 86, font: O6, color: i ? C.bordo : C.white, opacity: 0.07, rotate: degrees(45) });
  });
  return { bytes: await doc.save(), pages: pages.length, lastFill: (TOP - y) / (TOP - BOTTOM) };
}
