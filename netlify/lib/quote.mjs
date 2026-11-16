// Orçamentos automáticos: linhas discriminadas por serviço, link do sinal no Stripe e PDF com a marca.
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from "pdf-lib";
import { stripe, stripeReady } from "./common.mjs";

const INC = (d, det = "") => ({ d, det, q: 1, v: 0 });

// Serviços com orçamento automático. Os que não estão aqui (ex.: «Ainda não sei», redes sociais, planos mensais) ficam para a Beatriz responder.
export const QUOTE_SPECS = {
  "Websites|Landing Page": {
    title: "Landing Page",
    items: [
      { d: "Landing Page", det: "Uma página com as secções do teu negócio, pensada para levar quem a visita até ao contacto.", q: 1, v: 490 },
      INC("Design profissional à medida"), INC("Adaptada a telemóvel"), INC("SEO básico", "Títulos, descrições e estrutura para o Google."), INC("Formulário de contacto")
    ]
  },
  "Websites|Website Completo": {
    title: "Website Completo",
    prazo: "Até 14 dias",
    items: [
      { d: "Website Completo", det: "Website de 3 a 12 páginas, pensado para explicar o que fazes e levar ao contacto.", q: 1, v: 990 },
      INC("Design profissional à medida"), INC("Adaptado a telemóvel"), INC("SEO básico", "Títulos, descrições e estrutura para o Google."), INC("Formulário de contacto")
    ]
  },
  "Websites|Loja Online": {
    title: "Loja Online",
    notas: "Este é o valor base da loja. Se o teu projeto precisar de algo além do que está incluído, digo-te o valor antes de começar.",
    items: [
      { d: "Loja Online", det: "Loja online com design personalizado, pronta a vender.", q: 1, v: 1790 },
      INC("Adaptada a telemóvel"), INC("Páginas de produto"), INC("Carrinho e checkout"), INC("Métodos de pagamento"),
      INC("Configuração de envios"), INC("SEO básico para produtos"), INC("Formação para gerires a loja")
    ]
  },
  "Identidade Visual|Logótipo": {
    title: "Logótipo",
    items: [
      { d: "Logótipo", det: "O símbolo e o nome da tua marca, desenhados de raiz.", q: 1, v: 290 },
      INC("2 variações do logótipo"), INC("Versões a cores e a preto e branco"), INC("Ficheiros para digital e impressão"), INC("2 rondas de revisão")
    ]
  },
  "Identidade Visual|Identidade Visual Completa": {
    title: "Identidade Visual Completa",
    items: [
      { d: "Identidade Visual Completa", det: "Logótipo, cores, tipografia e elementos gráficos a trabalhar juntos.", q: 1, v: 790 },
      INC("Sessão de diagnóstico"), INC("Logótipo e 2 variações"), INC("Paleta de cores"), INC("Tipografia"), INC("Guia de marca"), INC("2 rondas de revisão")
    ]
  },
  "Identidade Visual|Rebranding": {
    title: "Rebranding",
    notas: "Este é o valor base do rebranding. Depois de conhecer melhor a tua marca, se o projeto precisar de mais, digo-te o valor antes de começar.",
    items: [
      { d: "Rebranding", det: "Renovar a tua marca sem perder o que os teus clientes já reconhecem.", q: 1, v: 1090 }
    ]
  },
  "Identidade Visual|Estacionário": {
    title: "Estacionário",
    items: [
      { d: "Estacionário", det: "Os materiais da tua marca, prontos a usar.", q: 1, v: 150 },
      INC("Cartões de visita"), INC("Papel de carta"), INC("Envelope"), INC("Assinatura de email"), INC("Ficheiros prontos para a gráfica")
    ]
  }
};

export const specFor = (lead) => (lead && lead.type === "proposta" && !lead.plano ? QUOTE_SPECS[lead.categoria + "|" + lead.subcategoria] || null : null);

export const eur = (n) => { n = Math.round((+n || 0) * 100) / 100; const [i, d] = n.toFixed(n % 1 ? 2 : 0).split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (d ? "," + d : "") + "€"; };
export const svcName = (l) => (l.categoria ? l.categoria + (l.subcategoria ? " — " + l.subcategoria : "") : l.plano || String(l.servico || "Projeto"));

// Link de pagamento do Stripe para um pedido (mesmo formato do painel).
export async function createLeadPay(s, lead, cents, desc, kind, redirect) {
  const payId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const price = await stripe("prices", { currency: "eur", unit_amount: cents, product_data: { name: desc } });
  const link = await stripe("payment_links", {
    "line_items[0][price]": price.id, "line_items[0][quantity]": 1,
    after_completion: { type: "redirect", redirect: { url: redirect } },
    restrictions: { completed_sessions: { limit: 1 } },
    metadata: { leadId: lead.id, payId, kind },
    payment_intent_data: { description: desc + " · " + (lead.nome || ""), metadata: { leadId: lead.id, payId, kind } }
  });
  await s.setJSON("paylinks/" + link.id, { leadId: lead.id, payId });
  return { id: payId, kind, link: link.id, url: link.url + (lead.email ? "?prefilled_email=" + encodeURIComponent(lead.email) : ""), amount: cents / 100, desc, status: "pending", createdAt: new Date().toISOString() };
}

// Cria o orçamento automático no pedido (número, token, linhas) e, se o Stripe estiver ligado, o link do sinal de 50%.
export async function autoQuote(s, lead, site) {
  const spec = specFor(lead);
  if (!spec) return null;
  const items = spec.items.map((x) => ({ ...x }));
  const total = Math.round(items.reduce((t, x) => t + x.q * x.v * 100, 0)) / 100;
  const seq = (await s.get("meta/quote-seq", { type: "json" })) || { n: 0 };
  seq.n += 1; await s.setJSON("meta/quote-seq", seq);
  const now = new Date().toISOString();
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const quote = { token, number: "ORC-" + new Date().getFullYear() + "-" + String(seq.n).padStart(3, "0"), items, total, prazo: spec.prazo || "", validade: 15, notas: spec.notas || "",
    origem: "auto", createdAt: now, updatedAt: now, sentAt: now };
  await s.setJSON("quotes/" + token, { leadId: lead.id });
  lead.quote = quote; lead.valor = total; lead.payments = lead.payments || [];
  const url = site + "/orcamento/?t=" + token;
  if (stripeReady()) {
    try { lead.payments.push(await createLeadPay(s, lead, Math.round(total * 100 / 2), "Sinal 50% · " + svcName(lead) + " · " + quote.number, "sinal", url + "&pago=1")); }
    catch (e) { console.error("auto-quote stripe", e); }
  }
  return { quote, url, spec };
}

/* ---------- PDF ---------- */
const C = { bordo: rgb(53 / 255, 14 / 255, 23 / 255), blush: rgb(240 / 255, 194 / 255, 174 / 255), rosa: rgb(246 / 255, 233 / 255, 230 / 255), ink: rgb(42 / 255, 18 / 255, 22 / 255), mut: rgb(116 / 255, 84 / 255, 90 / 255), line: rgb(235 / 255, 215 / 255, 218 / 255), white: rgb(1, 1, 1) };
const longDate = (iso) => new Date(iso).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Lisbon" });
// Helvetica do PDF usa WinAnsi: troca caracteres fora dessa tabela.
const safe = (t) => String(t ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/→/g, "->").replace(/[^\x20-\x7E\xA0-\xFF€—–…·•]/g, "");

function wrap(font, text, size, max) {
  const out = []; let line = "";
  for (const w of safe(text).split(/\s+/)) {
    const t = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(t, size) > max && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

export async function quotePdf(lead, url) {
  const q = lead.quote;
  const doc = await PDFDocument.create();
  doc.setTitle("Orçamento " + q.number + " · Beatriz Studio"); doc.setAuthor("Beatriz Studio"); doc.setCreator("beatrizstudio.pt");
  const R = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 48;
  let page = doc.addPage([W, H]), y = H;
  const text = (t, x, yy, o = {}) => page.drawText(safe(t), { x, y: yy, size: o.size || 10, font: o.font || R, color: o.color || C.ink });
  const right = (t, xr, yy, o = {}) => { const f = o.font || R, s = o.size || 10; text(t, xr - f.widthOfTextAtSize(safe(t), s), yy, o); };
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };

  // cabeçalho bordô
  page.drawRectangle({ x: 0, y: H - 130, width: W, height: 130, color: C.bordo });
  text("beatriz studio", M, H - 70, { font: B, size: 24, color: C.white });
  page.drawCircle({ x: M + B.widthOfTextAtSize("beatriz studio", 24) + 4.5, y: H - 68.5, size: 2.6, color: C.blush });
  text("Websites · Identidade Visual · Templates", M, H - 90, { size: 9, color: C.blush });
  right("ORÇAMENTO", W - M, H - 62, { font: B, size: 10, color: C.blush });
  right(q.number, W - M, H - 82, { font: B, size: 16, color: C.white });
  const exp = new Date(new Date(q.sentAt || q.createdAt).getTime() + (q.validade || 15) * 864e5).toISOString();
  right(longDate(q.sentAt || q.createdAt) + " · válido até " + longDate(exp), W - M, H - 100, { size: 9, color: C.blush });
  y = H - 175;

  text(lead.subcategoria || svcName(lead), M, y, { font: B, size: 22 }); y -= 22;
  text("Preparado para " + lead.nome + (lead.marca ? " · " + lead.marca : ""), M, y, { size: 11, color: C.mut }); y -= 30;

  // caixas: cliente · prazo · total
  const bw = (W - 2 * M - 20) / 3;
  [["CLIENTE", lead.nome, lead.email], ["PRAZO", q.prazo || "A combinar", ""], ["TOTAL", eur(q.total), ""]].forEach((b, i) => {
    const x = M + i * (bw + 10);
    page.drawRectangle({ x, y: y - 52, width: bw, height: 58, color: C.rosa });
    text(b[0], x + 12, y - 12, { font: B, size: 7.5, color: C.mut });
    text(b[1], x + 12, y - 30, { font: B, size: 12 });
    if (b[2]) text(b[2], x + 12, y - 44, { size: 8.5, color: C.mut });
  });
  y -= 82;

  // tabela
  text("DESCRIÇÃO", M, y, { font: B, size: 7.5, color: C.mut }); right("VALOR", W - M, y, { font: B, size: 7.5, color: C.mut });
  y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: C.bordo }); y -= 18;
  for (const it of q.items) {
    const main = it.v > 0, det = it.det ? wrap(R, it.det, 9, W - 2 * M - 120) : [];
    const need = 14 + det.length * 12 + 10;
    if (y - need < 120) { newPage(); }
    if (main) text(it.d + (it.q > 1 ? "  ×" + it.q : ""), M, y, { font: B, size: 11.5 });
    else { page.drawCircle({ x: M + 3, y: y + 3.2, size: 2, color: C.blush }); text(it.d, M + 12, y, { size: 10 }); }
    right(main ? eur(it.q * it.v) : "Incluído", W - M, y, { font: main ? B : R, size: main ? 11.5 : 9.5, color: main ? C.ink : C.mut });
    y -= main ? 14 : det.length ? 12 : 6;
    det.forEach((l) => { text(l, main ? M : M + 12, y, { size: 9, color: C.mut }); y -= 12; });
    if (main) { y -= 4; page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.6, color: C.line }); y -= 16; } else y -= 12;
  }
  y -= 2; page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.6, color: C.line }); y -= 10;
  if (y < 230) newPage();
  right("Total", W - M - 110, y - 2, { font: B, size: 12 }); right(eur(q.total), W - M, y - 2, { font: B, size: 16 }); y -= 40;

  // 50% + 50%
  const half = Math.round(q.total * 100 / 2) / 100, rest = Math.round((q.total - half) * 100) / 100, hw = (W - 2 * M - 12) / 2;
  [["1. PARA COMEÇAR", eur(half), "50% na aprovação do orçamento"], ["2. NA ENTREGA", eur(rest), "50% quando o projeto estiver pronto"]].forEach((b, i) => {
    const x = M + i * (hw + 12);
    page.drawRectangle({ x, y: y - 56, width: hw, height: 62, borderColor: C.line, borderWidth: 1, color: C.white });
    text(b[0], x + 14, y - 12, { font: B, size: 7.5, color: C.mut });
    text(b[1], x + 14, y - 32, { font: B, size: 16 });
    text(b[2], x + 14, y - 47, { size: 8.5, color: C.mut });
  });
  y -= 80;
  if (q.notas) { for (const l of wrap(R, q.notas, 9.5, W - 2 * M)) { if (y < 120) newPage(); text(l, M, y, { size: 9.5, color: C.mut }); y -= 13; } y -= 10; }

  // aprovar online
  if (y < 140) newPage();
  page.drawRectangle({ x: M, y: y - 58, width: W - 2 * M, height: 64, color: C.bordo });
  text("Para avançar, aprova o orçamento online", M + 16, y - 16, { font: B, size: 12, color: C.white });
  text("Pagas 50% por cartão, MB WAY ou Multibanco e o resto só na entrega.", M + 16, y - 32, { size: 9, color: C.blush });
  text(url, M + 16, y - 47, { size: 8.5, color: C.white });
  // link clicável
  const annot = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [M, y - 58, W - M, y + 6], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
  page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annot)]));

  // rodapé em todas as páginas
  for (const pg of doc.getPages()) {
    pg.drawLine({ start: { x: M, y: 52 }, end: { x: W - M, y: 52 }, thickness: 0.6, color: C.line });
    pg.drawText(safe("Beatriz Studio · beatrizstudio.pt"), { x: M, y: 36, size: 8.5, font: B, color: C.ink });
    const t = safe("beatrizmachadostudio@gmail.com · WhatsApp +351 936 507 808 · @beatrizstudio.pt");
    pg.drawText(t, { x: W - M - R.widthOfTextAtSize(t, 8.5), y: 36, size: 8.5, font: R, color: C.mut });
  }
  return await doc.save();
}
