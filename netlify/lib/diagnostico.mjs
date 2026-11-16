// Diagnóstico Digital Gratuito: estados, validação do pedido, rascunho do relatório e PDF com a marca.
// Regra central: nenhum diagnóstico segue para o cliente sem aprovação da Beatriz (ver canSend).
import { PDFDocument, rgb, degrees, PDFName, PDFString, pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clip, endPath, appendBezierCurve } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { OUTFIT_400, OUTFIT_600, INCLUSIVE_400, INCLUSIVE_600, ISERIF_ITALIC, LOGO_LIGHT, LOGO_DARK, PORTRAIT } from "./diag-assets.mjs";
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
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const date = opts.date || new Date().toISOString();
  const brand = String(lead.marca || lead.nome || "");
  doc.setTitle("Diagnóstico Digital · " + brand + " · Beatriz Studio"); doc.setAuthor("Beatriz Studio"); doc.setCreator("beatrizstudio.pt"); doc.setLanguage("pt-PT");
  const emb = (bytes) => doc.embedFont(bytes, { subset: true });
  const [O4, O6, S4, S6, IT] = await Promise.all([emb(OUTFIT_400()), emb(OUTFIT_600()), emb(INCLUSIVE_400()), emb(INCLUSIVE_600()), emb(ISERIF_ITALIC())]);
  const [logoL, logoD, portrait] = await Promise.all([doc.embedPng(LOGO_LIGHT()), doc.embedPng(LOGO_DARK()), doc.embedJpg(PORTRAIT())]);
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

  const W = 595.28, H = 841.89, M = 50, CW = W - 2 * M, TOP = H - 86, BOTTOM = 66;
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
  const imageCircle = (img, cx, cy, r) => {
    const k = 0.5523 * r;
    page.pushOperators(pushGraphicsState(), moveTo(cx + r, cy), appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r), appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy), appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r), appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy), closePath(), clip(), endPath());
    page.drawImage(img, { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r });
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
    const size = o.size || 10.5, lh = o.lh || size * 1.55, font = o.font || S4, x = o.x ?? M, max = o.max || CW - (x - M);
    const lines = wrap(font, t, size, max);
    lines.forEach((l, i) => {
      // nunca deixa uma única linha sozinha no fim ou no início de uma página
      const left = lines.length - i;
      if (y - lh < BOTTOM || (left === 2 && lines.length > 2 && y - 2 * lh < BOTTOM)) newPage();
      if (l) text(l, x, y - size * 0.82, { size, font, color: o.color || C.ink });
      y -= lh;
    });
    y -= o.after ?? 8;
  };
  const label = (t, x, yy, color) => text(t.toUpperCase(), x, yy, { font: S6, size: 7.2, color: color || C.mut });
  let secN = 0;
  // título de secção: número em itálico + título em Outfit com a última parte em Instrument Serif Italic
  const section = (plain, accent, minAfter = 70) => {
    need(84 + minAfter); if (y < TOP) y -= 18;
    secN++;
    text(String(secN).padStart(2, "0"), M, y - 9, { font: IT, size: 13, color: C.bordo });
    page.drawLine({ start: { x: M + 22, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.7, color: C.pink });
    y -= 22;
    const p1 = tidy(O4, plain + " "), w1 = width(O4, p1, 22);
    text(p1, M, y - 19, { font: O4, size: 22, color: C.ink });
    text(accent, M + w1, y - 19, { font: IT, size: 25, color: C.bordo });
    y -= 40;
  };

  newPage();
  // introdução em destaque
  para(report.introducao, { font: O4, size: 13.5, lh: 21, after: 6 });

  section("Presença digital", "atual.");
  para(report.presenca);
  if (report.pontosFortes.length) {
    const inner = CW - 60, L = report.pontosFortes.map((t) => wrap(S4, t, 10, inner));
    const h = 34 + L.reduce((t, l) => t + l.length * 15 + 6, 0) + 8;
    need(h + 6); y -= 4;
    rrect(M, y, CW, h, 12, { color: C.rosa });
    label("O que já funciona", M + 18, y - 21, C.bordo);
    let yy = y - 40;
    L.forEach((lines) => {
      page.drawCircle({ x: M + 25, y: yy + 3.4, size: 7, color: C.blush });
      icon("check", M + 19.6, yy + 8.8, 10.8, C.bordo, 1.4);
      lines.forEach((l) => { text(l, M + 42, yy, { size: 10 }); yy -= 15; });
      yy -= 6;
    });
    y -= h + 14;
  }
  if (report.materiais.length) {
    const L = report.materiais.map((t) => wrap(S4, t, 8.5, CW - 14));
    need(18 + L.reduce((t, l) => t + l.length * 12, 0));
    label("O que analisei", M, y - 8); y -= 20;
    L.forEach((lines) => { page.drawCircle({ x: M + 2.5, y: y - 5.2, size: 1.4, color: C.mut }); lines.forEach((l) => { text(l, M + 12, y - 8, { size: 8.5, color: C.mut }); y -= 12; }); });
    y -= 8;
  }

  const PR = { Alta: [C.bordo, C.white], "Média": [C.blush, C.deep], Baixa: [C.pink, C.deep] };
  const cards = report.melhorias.map((m) => {
    const X = M + 62, inner = W - M - 20 - X;
    const rowsDef = [["eye", "O que observei", m.observacao], ["spark", "Porque importa", m.importancia], ["arrow", "Como melhorar", m.acao]].filter((r) => r[2]);
    const lines = rowsDef.map((r) => wrap(S4, r[2], 10, inner - 20));
    const pill = m.prioridade ? "PRIORIDADE " + m.prioridade.toUpperCase() : "", pw = pill ? width(S6, tidy(S6, pill), 6.6) + 16 : 0;
    const tl = wrap(O6, m.titulo, 14, inner - pw - 10);
    const h = 22 + tl.length * 18 + 8 + lines.reduce((t, l) => t + 15 + l.length * 15 + 8, 0) + 6;
    return { m, X, rowsDef, lines, pill, pw, tl, h };
  });
  section("Três melhorias", "prioritárias.", Math.min(cards[0].h + 12, TOP - BOTTOM - 80));
  cards.forEach(({ m, X, rowsDef, lines, pill, pw, tl, h }, i) => {
    need(Math.min(h + 12, TOP - BOTTOM));
    const top = y;
    rrect(M, top, CW, h, 14, { color: C.rosa });
    text(String(i + 1).padStart(2, "0"), M + 16, top - 44, { font: IT, size: 36, color: C.bordo });
    let yy = top - 34;
    tl.forEach((l) => { text(l, X, yy, { font: O6, size: 14 }); yy -= 18; });
    if (pill) { const col = PR[m.prioridade] || PR.Baixa; rrect(W - M - 16 - pw, top - 20, pw, 16, 8, { color: col[0] }); text(pill, W - M - 16 - pw + 8, top - 30.6, { font: S6, size: 6.6, color: col[1] }); }
    yy -= 8;
    rowsDef.forEach((r, k) => {
      icon(r[0], X, yy + 9.5, 11, C.bordo, 1.3);
      label(r[1], X + 20, yy, C.bordo); yy -= 15;
      lines[k].forEach((l) => { text(l, X + 20, yy, { size: 10 }); yy -= 15; });
      yy -= 8;
    });
    y = top - h - 12;
  });

  if (report.sugestaoVisual) {
    const sv = report.sugestaoVisual, ih = mock ? Math.min(250, (CW * mock.height) / mock.width + 20) : 0;
    section("Sugestão", "visual.", mock ? ih + 60 : 60);
    if (sv.titulo) para(sv.titulo, { font: O6, size: 12.5, after: 2 });
    if (sv.descricao) para(sv.descricao);
    if (mock) {
      need(ih + 28); y -= 4;
      browserFrame(mock, M, y, CW, ih, "Exemplo ilustrativo", false);
      y -= ih + 8;
      text("Exemplo ilustrativo da sugestão. Não representa um projeto final.", M, y - 8, { size: 8, color: C.mut }); y -= 22;
    }
  }

  section("Próximos", "passos.", 60);
  report.proximosPassos.forEach((s, i) => {
    const lines = wrap(S4, s, 10.5, CW - 44), h = Math.max(30, lines.length * 16 + 12);
    need(h);
    if (i < report.proximosPassos.length - 1) page.drawLine({ start: { x: M + 11, y: y - 22 }, end: { x: M + 11, y: y - h - 2 }, thickness: 0.8, color: C.pink });
    page.drawCircle({ x: M + 11, y: y - 11, size: 11, color: C.bordo });
    const num = String(i + 1); text(num, M + 11 - width(O6, num, 10) / 2, y - 14.6, { font: O6, size: 10, color: C.white });
    let yy = y - 14.5; lines.forEach((l) => { text(l, M + 36, yy, { size: 10.5 }); yy -= 16; });
    y -= h;
  });
  y -= 6;

  if (report.servico) {
    const sv = report.servico, wl = sv.porque ? wrap(S4, sv.porque, 10, CW - 44) : [];
    const note = wrap(S4, "Esta sugestão é opcional. O diagnóstico é teu e podes aplicar as recomendações da forma que fizer mais sentido para ti.", 8.5, CW - 44);
    const h = 62 + wl.length * 15 + (wl.length ? 10 : 0) + note.length * 12 + 14;
    section("Uma solução", "possível.", h);
    need(h);
    const top = y;
    rrect(M, top, CW, h, 14, { color: C.bordo });
    label("Serviço que pode ajudar", M + 22, top - 24, C.blush);
    text(sv.nome, M + 22, top - 48, { font: O6, size: 18, color: C.white });
    if (sv.preco) { const pt = tidy(S6, sv.preco), pw = width(S6, pt, 10) + 22; rrect(W - M - 22 - pw, top - 30, pw, 24, 12, { color: C.blush }); text(pt, W - M - 22 - pw + 11, top - 45.6, { font: S6, size: 10, color: C.deep }); }
    let yy = top - 70;
    wl.forEach((l) => { text(l, M + 22, yy, { size: 10, color: C.white }); yy -= 15; });
    if (wl.length) yy -= 10;
    note.forEach((l) => { text(l, M + 22, yy, { size: 8.5, color: C.pink }); yy -= 12; });
    y = top - h - 14;
  }
  if (report.notaAmbito) { const L = wrap(S4, report.notaAmbito, 8.5, CW); need(22 + L.length * 12); label("Nota de âmbito", M, y - 8); y -= 20; L.forEach((l) => { text(l, M, y - 8, { size: 8.5, color: C.mut }); y -= 12; }); y -= 8; }

  // fecho: convite sem pressão, com o retrato e os contactos
  const sig = opts.sig || {}, site = String(opts.site || "https://beatrizstudio.pt").replace(/\/$/, ""), url = site + "/contacto/";
  const CH = 128;
  need(CH + 10); y -= 6;
  const ctop = y;
  rrect(M, ctop, CW, CH, 16, { color: C.rosa });
  imageCircle(portrait, M + 62, ctop - CH / 2, 40);
  page.drawCircle({ x: M + 62, y: ctop - CH / 2, size: 40, borderColor: C.blush, borderWidth: 2, opacity: 0 });
  const cx = M + 124;
  text("Queres conversar sobre isto?", cx, ctop - 38, { font: IT, size: 23, color: C.bordo });
  wrap(S4, "Se fizer sentido para ti, responde ao email ou fala comigo. Sem compromisso.", 10, W - M - 20 - cx).forEach((l, i) => text(l, cx, ctop - 58 - i * 15, { size: 10 }));
  const contacts = [sig.email, sig.telefone && "WhatsApp " + sig.telefone, url.replace(/^https?:\/\//, "")].filter(Boolean);
  let fs = 8.8; while (fs > 6.5 && width(S6, tidy(S6, contacts.join("   ·   ")), fs) > W - M - 20 - cx) fs -= 0.3;
  text(contacts.join("   ·   "), cx, ctop - 84, { font: S6, size: fs, color: C.bordo });
  text("Beatriz Machado", cx, ctop - 108, { font: IT, size: 15, color: C.bordo });
  text("Beatriz Studio", cx + width(IT, "Beatriz Machado", 15) + 8, ctop - 107.5, { size: 8.5, color: C.mut });
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
      pg.drawLine({ start: { x: M, y: H - 60 }, end: { x: W - M, y: H - 60 }, thickness: 0.6, color: C.pink });
      pg.drawLine({ start: { x: M, y: 48 }, end: { x: W - M, y: 48 }, thickness: 0.6, color: C.pink });
      pg.drawText("beatrizstudio.pt", { x: M, y: 33, size: 8, font: S6, color: C.bordo });
      const n = String(i + 1).padStart(2, "0") + " / " + String(pages.length).padStart(2, "0");
      pg.drawText(n, { x: W - M - width(S4, n, 8), y: 33, size: 8, font: S4, color: C.mut });
    }
    if (opts.draft) pg.drawText("RASCUNHO", { x: 120, y: 250, size: 86, font: O6, color: i ? C.bordo : C.white, opacity: 0.07, rotate: degrees(45) });
  });
  return await doc.save();
}
