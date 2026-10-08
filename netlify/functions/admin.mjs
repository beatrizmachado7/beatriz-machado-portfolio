// API privada do painel: pedidos, clientes, agenda, mensagens, testemunhos e equipa.
// A Beatriz (dona) entra com a palavra-passe ADMIN_PASSWORD (Netlify).
// Pessoas da equipa entram com email + palavra-passe própria, criada por um link de convite.
// A equipa não vê faturação (valores e pagamentos) e cada pessoa tem a sua própria agenda.
import { createHash, timingSafeEqual } from "node:crypto";
import { json, env, sha, ip, limited, hashPw, checkPw, newToken, newCode, codeBox, store as getCrm, publicUser, sendMail, mailLayout, mailText, mailReady, p, button, siteUrl, emailOk, stripe, stripeReady, getSignature, signatureText } from "../lib/common.mjs";

const OWNER_COLS = new Set(["leads", "clients", "projects", "boards", "agenda", "templates"]);
const MEMBER_COLS = new Set(["leads", "agenda", "templates"]);
const SESSION_DAYS = 365, INVITE_DAYS = 7, CODE_MIN = 15;
const ownerEmails = () => String(env("OWNER_EMAIL") || "beatrizmachadostudio@gmail.com,b.machadoo188@gmail.com").toLowerCase().split(/[,\s]+/).filter(Boolean);
const MONEY = ["valor", "pago", "pagoEm", "payments", "quote", "sinalEm"];
const MEMBER_LEAD_FIELDS = ["notes", "visto", "history"];

const hash = (s) => createHash("sha256").update(String(s)).digest();
const ownerPwOk = (given) => { const pw = env("ADMIN_PASSWORD"); return !!pw && timingSafeEqual(hash(given || ""), hash(pw)); };
const OWNER = { uid: "owner", role: "owner", name: "Beatriz Machado" };

async function list(store, prefix, limit) {
  const { blobs } = await store.list({ prefix });
  const keys = blobs.map((b) => b.key).sort().reverse().slice(0, limit || 1e6);
  const items = await Promise.all(keys.map((k) => store.get(k, { type: "json" })));
  return items.filter(Boolean);
}
const newest = (a, b) => String(b.createdAt || b.at).localeCompare(String(a.createdAt || a.at));
const pubStaff = (m) => ({ id: m.id, name: m.name, email: m.email, createdAt: m.createdAt, active: !!m.pw, invitedAt: m.invitedAt || null });
const stripMoney = (l) => { const o = { ...l }; MONEY.forEach((k) => delete o[k]); return o; };
const mine = (me) => (a) => (a.uid || "owner") === me.uid;
const memberMe = (st) => ({ uid: st.id, role: "member", name: st.name, email: st.email });

async function newSession(store, uid) {
  const token = newToken();
  await store.setJSON("asess/" + sha(token), { uid, exp: Date.now() + SESSION_DAYS * 864e5 });
  return token;
}
async function who(req, store) {
  const key = req.headers.get("x-admin-key");
  if (key) return ownerPwOk(key) ? OWNER : null;
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const k = "asess/" + sha(m[1].trim());
  const ses = await store.get(k, { type: "json" });
  if (!ses || ses.exp < Date.now()) { if (ses) await store.delete(k); return null; }
  if (ses.exp - Date.now() < (SESSION_DAYS - 30) * 864e5) await store.setJSON(k, { ...ses, exp: Date.now() + SESSION_DAYS * 864e5 });
  if (ses.uid === "owner") return OWNER;
  const st = await store.get("staff/" + ses.uid, { type: "json" });
  if (!st || !st.pw) return null;
  return memberMe(st);
}
async function createInvite(store, member, req) {
  const token = newToken().slice(0, 32);
  await store.setJSON("sinv/" + token, { staffId: member.id, exp: Date.now() + INVITE_DAYS * 864e5 });
  const link = siteUrl(req) + "/admin/?convite=" + token;
  let mailed = false;
  if (mailReady()) {
    const first = member.name.split(" ")[0];
    const r = await sendMail({ to: member.email, subject: "Acesso ao painel da Beatriz Machado",
      html: mailLayout("Olá " + first + "!", p("A Beatriz deu-te acesso ao painel do estúdio. Não precisas de criar conta em lado nenhum: carrega no botão, cria a tua palavra-passe e fica feito.") + button(link, "Entrar no painel") + p("Também podes entrar a qualquer momento em " + siteUrl(req) + "/admin com o teu email (" + member.email + ").")),
      text: `Olá ${first}!\n\nA Beatriz deu-te acesso ao painel do estúdio. Entra aqui e cria a tua palavra-passe:\n${link}\n\nTambém podes entrar em ${siteUrl(req)}/admin com o teu email (${member.email}).` });
    mailed = !!r.ok;
  }
  return { link, mailed };
}

export default async (req) => {
  const store = getCrm();
  const url = new URL(req.url);
  let body = null;
  if (req.method === "POST") { try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); } }
  const a = body && body.action;

  /* ---------- ações públicas: entrar e aceitar convite ---------- */
  if (a === "login") {
    if (!env("ADMIN_PASSWORD")) return json({ error: "A variável ADMIN_PASSWORD ainda não está configurada no Netlify." }, 500);
    if (await limited(store, "alogin:" + ip(req), 12, 15 * 6e4)) return json({ error: "Demasiadas tentativas. Espera 15 minutos." }, 429);
    const email = String(body.email || "").trim().toLowerCase(), pw = String(body.password || "");
    if (ownerPwOk(pw)) return json({ ok: true, token: await newSession(store, "owner"), me: OWNER });
    if (email) {
      const idx = await store.get("staffidx/" + sha(email), { type: "json" });
      const st = idx && (await store.get("staff/" + idx.id, { type: "json" }));
      if (st && st.pw && checkPw(pw, st.pw)) return json({ ok: true, token: await newSession(store, st.id), me: memberMe(st) });
    }
    return json({ error: "Email ou palavra-passe incorretos." }, 401);
  }
  if (a === "login-start" || a === "setup-password") {
    if (!env("ADMIN_PASSWORD")) return json({ error: "A variável ADMIN_PASSWORD ainda não está configurada no Netlify." }, 500);
    const email = String(body.email || "").trim().toLowerCase();
    if (!emailOk(email)) return json({ error: "Escreve um email válido." }, 400);
    if (await limited(store, "astart:" + ip(req), 30, 15 * 6e4)) return json({ error: "Demasiadas tentativas. Espera 15 minutos." }, 429);
    if (ownerEmails().includes(email)) {
      if (a === "setup-password" || body.reset) return json({ error: "A tua palavra-passe é a ADMIN_PASSWORD, definida no Netlify (Project configuration → Environment variables)." }, 400);
      return json({ ok: true, step: "password", name: "Beatriz" });
    }
    const idx = await store.get("staffidx/" + sha(email), { type: "json" });
    const st = idx && (await store.get("staff/" + idx.id, { type: "json" }));
    if (!st) return json({ error: "Este email não tem acesso ao painel. Pede à Beatriz para te adicionar." }, 404);
    const first = st.name.split(" ")[0];
    if (a === "login-start") {
      if (st.pw && !body.reset) return json({ ok: true, step: "password", name: first });
      if (await limited(store, "acode:" + email, 6, 36e5)) return json({ error: "Já pedimos vários códigos. Espera um pouco e vê o teu email (e o spam)." }, 429);
      const code = newCode();
      await store.setJSON("staff/" + st.id, { ...st, code: { h: sha(code), exp: Date.now() + CODE_MIN * 6e4, tries: 0 } });
      let mailed = false;
      if (mailReady()) {
        const r = await sendMail({ to: st.email, subject: "O teu código: " + code,
          html: mailLayout("Olá " + first + "!", p("Este é o teu código para " + (st.pw ? "mudares a palavra-passe" : "criares a palavra-passe") + " do painel. É válido durante " + CODE_MIN + " minutos.") + codeBox(code)),
          text: `Olá ${first}!\n\nO teu código para o painel: ${code}\nÉ válido durante ${CODE_MIN} minutos.` });
        mailed = !!r.ok;
      }
      if (!mailed) return json({ error: "Não foi possível enviar o código por email. Pede à Beatriz um link de acesso (secção Equipa)." }, 502);
      return json({ ok: true, step: "setup", name: first, reset: !!st.pw });
    }
    const c = st.code;
    if (!c || c.exp < Date.now()) return json({ error: "O código expirou. Pede um novo." }, 400);
    if ((c.tries || 0) >= 5) return json({ error: "Demasiadas tentativas. Pede um novo código." }, 429);
    if (sha(String(body.code || "").replace(/\D/g, "")) !== c.h) {
      await store.setJSON("staff/" + st.id, { ...st, code: { ...c, tries: (c.tries || 0) + 1 } });
      return json({ error: "O código não está certo. Confirma no teu email." }, 400);
    }
    const pw = String(body.password || "");
    if (pw.length < 8) return json({ error: "A palavra-passe precisa de ter pelo menos 8 caracteres." }, 400);
    const upd = { ...st, pw: hashPw(pw), activatedAt: st.activatedAt || new Date().toISOString() };
    delete upd.code;
    await store.setJSON("staff/" + st.id, upd);
    return json({ ok: true, token: await newSession(store, st.id), me: memberMe(upd) });
  }
  if (a === "quote-view") {
    const tok = String(body.token || "");
    if (!/^[\w-]{10,64}$/.test(tok)) return json({ error: "Link inválido." }, 400);
    const map = await store.get("quotes/" + tok, { type: "json" });
    const lead = map && (await store.get("leads/" + map.leadId, { type: "json" }));
    if (!lead || !lead.quote || lead.quote.token !== tok) return json({ error: "Este orçamento já não está disponível." }, 404);
    const q = lead.quote, P = (lead.payments || []).filter((x) => x.kind === "sinal" || x.kind === "final");
    const pub = (k) => { const L = P.filter((x) => x.kind === k && x.status !== "cancelled").slice(-1)[0]; return L ? { amount: L.amount, status: L.status, url: L.status === "pending" || L.status === "waiting" ? L.url : null, paidAt: L.paidAt || null } : null; };
    return json({ ok: true, quote: { number: q.number, createdAt: q.createdAt, sentAt: q.sentAt || q.createdAt, items: q.items, total: q.total, prazo: q.prazo, validade: q.validade, notas: q.notas },
      client: { nome: lead.nome, marca: lead.marca || "", email: lead.email || "" }, service: lead.categoria ? lead.categoria + (lead.subcategoria ? " — " + lead.subcategoria : "") : (lead.plano || lead.servico || ""),
      sinal: pub("sinal"), final: pub("final") });
  }
  if (a === "invite-info" || a === "accept-invite") {
    const tok = String(body.token || "");
    if (!/^[\w-]{10,64}$/.test(tok)) return json({ error: "Link inválido." }, 400);
    const inv = await store.get("sinv/" + tok, { type: "json" });
    const st = inv && inv.exp > Date.now() && (await store.get("staff/" + inv.staffId, { type: "json" }));
    if (!st) return json({ error: "Este link já não é válido. Pede um novo à Beatriz." }, 404);
    if (a === "invite-info") return json({ ok: true, name: st.name, email: st.email });
    const pw = String(body.password || "");
    if (pw.length < 8) return json({ error: "A palavra-passe precisa de ter pelo menos 8 caracteres." }, 400);
    await store.setJSON("staff/" + st.id, { ...st, pw: hashPw(pw), activatedAt: new Date().toISOString() });
    await store.delete("sinv/" + tok);
    return json({ ok: true, token: await newSession(store, st.id), me: memberMe(st) });
  }

  /* ---------- daqui para baixo é preciso ter sessão ---------- */
  if (!env("ADMIN_PASSWORD")) return json({ error: "A variável ADMIN_PASSWORD ainda não está configurada no Netlify." }, 500);
  const me = await who(req, store);
  if (!me) return json({ error: "Sessão terminada. Entra de novo." }, 401);
  const owner = me.role === "owner";

  if (req.method === "GET") {
    const [leads, agenda, templates] = await Promise.all([list(store, "leads/"), list(store, "agenda/"), list(store, "templates/")]);
    const base = { me, leads: (owner ? leads : leads.map(stripMoney)).sort(newest), agenda: agenda.filter(mine(me)), templates };
    base.stripe = owner ? stripeReady() : false;
    if (!owner) return json({ ...base, clients: [], projects: [], users: [], notifs: [], testimonials: [], invites: [], boards: [], staff: [] });
    const [clients, projects, users, notifs, testimonials, invites, boardList, staff] = await Promise.all([
      list(store, "clients/"), list(store, "projects/"), list(store, "users/"), list(store, "notifs/", 60),
      list(store, "testimonials/"), list(store, "invites/"), list(store, "boards/"), list(store, "staff/")
    ]);
    return json({
      ...base, clients: clients.sort(newest), projects: projects.sort(newest),
      users: users.filter((u) => u.status === "active").map(publicUser).sort(newest),
      notifs: notifs.sort(newest), testimonials: testimonials.sort(newest), invites: invites.sort(newest), boards: boardList,
      staff: staff.map(pubStaff).sort(newest)
    });
  }

  if (req.method === "POST") {
    if (a === "logout") {
      const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
      if (m) await store.delete("asess/" + sha(m[1].trim()));
      return json({ ok: true });
    }
    if (a === "send-message") {
      const id = String(body.id || "");
      if (!/^[\w-]+$/.test(id)) return json({ error: "Dados inválidos" }, 400);
      const lead = await store.get("leads/" + id, { type: "json" });
      if (!lead) return json({ error: "Pedido não encontrado" }, 404);
      if (!lead.email) return json({ error: "Este pedido não tem email." }, 400);
      const text = String(body.text || "").slice(0, 8000).trim(), subject = String(body.subject || "Beatriz Machado").slice(0, 200).trim();
      if (!text) return json({ error: "A mensagem está vazia." }, 400);
      if (!mailReady()) return json({ error: "O envio de emails não está configurado no Netlify." }, 500);
      const sig = await getSignature(store, owner ? "" : me.name);
      const r = await sendMail({ to: lead.email, subject, html: mailLayout(subject, mailText(text), sig), text: text + signatureText(sig), replyTo: env("REPLY_TO") || "beatrizmachadostudio@gmail.com" });
      if (!r.ok) return json({ error: "O serviço de email recusou o envio. Tenta novamente daqui a pouco." }, 502);
      const upd = { ...lead, visto: true, history: [...(lead.history || []), { at: new Date().toISOString(), via: "email", subject, text, by: me.name, tpl: String(body.tpl || "").replace(/[^\w-]/g, "").slice(0, 40) }], updatedAt: new Date().toISOString() };
      await store.setJSON("leads/" + id, upd);
      return json({ ok: true, item: owner ? upd : stripMoney(upd) });
    }

    if (a) {
      if (!owner) return json({ error: "Sem permissão." }, 403);
      /* pagamentos (Stripe) */
      const loadLead = async () => { const id = String(body.id || "").replace(/[^\w-]/g, ""); return { id, lead: await store.get("leads/" + id, { type: "json" }) }; };
      const createPay = async (lead, cents, desc, kind, redirect) => {
        const payId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const price = await stripe("prices", { currency: "eur", unit_amount: cents, product_data: { name: desc } });
        const link = await stripe("payment_links", {
          "line_items[0][price]": price.id, "line_items[0][quantity]": 1,
          after_completion: { type: "redirect", redirect: { url: redirect || siteUrl(req) + "/pagamento/" } },
          restrictions: { completed_sessions: { limit: 1 } },
          metadata: { leadId: lead.id, payId, kind },
          payment_intent_data: { description: desc + " · " + (lead.nome || ""), metadata: { leadId: lead.id, payId, kind } }
        });
        await store.setJSON("paylinks/" + link.id, { leadId: lead.id, payId });
        return { id: payId, kind, link: link.id, url: link.url + (lead.email ? "?prefilled_email=" + encodeURIComponent(lead.email) : ""), amount: cents / 100, desc, status: "pending", createdAt: new Date().toISOString() };
      };
      const cancelPending = async (lead, kind) => {
        for (const p of (lead.payments || []).filter((x) => x.kind === kind && (x.status === "pending" || x.status === "waiting"))) {
          if (p.link) { try { await stripe("payment_links/" + p.link, { active: "false" }); } catch (e) { console.error(e); } }
          p.status = "cancelled";
        }
      };
      const paidOf = (lead) => (lead.payments || []).filter((x) => x.status === "paid").reduce((t, x) => t + Math.round(x.amount * 100), 0);
      const svcName = (l) => l.categoria ? l.categoria + (l.subcategoria ? " — " + l.subcategoria : "") : (l.plano || String(l.servico || "Projeto"));
      const quoteUrl = (q) => siteUrl(req) + "/orcamento/?t=" + q.token;

      if (a === "quote-save") {
        const { id, lead } = await loadLead();
        if (!lead) return json({ error: "Pedido não encontrado" }, 404);
        const q = body.quote || {};
        const items = (Array.isArray(q.items) ? q.items : []).slice(0, 40).map((x) => ({
          d: String(x.d || "").trim().slice(0, 160), det: String(x.det || "").trim().slice(0, 600),
          q: Math.max(1, Math.min(999, parseInt(x.q, 10) || 1)), v: Math.max(0, Math.round(parseFloat(String(x.v || "0").replace(",", ".")) * 100) / 100)
        })).filter((x) => x.d);
        if (!items.length) return json({ error: "Adiciona pelo menos uma linha ao orçamento." }, 400);
        const total = Math.round(items.reduce((t, x) => t + x.q * x.v * 100, 0)) / 100;
        if (!(total >= 1)) return json({ error: "O total do orçamento tem de ser pelo menos 1€." }, 400);
        const prev = lead.quote || {};
        let number = prev.number;
        if (!number) {
          const seq = (await store.get("meta/quote-seq", { type: "json" })) || { n: 0 };
          seq.n += 1; await store.setJSON("meta/quote-seq", seq);
          number = "ORC-" + new Date().getFullYear() + "-" + String(seq.n).padStart(3, "0");
        }
        const token = prev.token || newToken().slice(0, 24);
        const quote = { ...prev, token, number, items, total, prazo: String(q.prazo || "").slice(0, 120), validade: Math.max(1, Math.min(90, parseInt(q.validade, 10) || 15)),
          notas: String(q.notas || "").slice(0, 1200), updatedAt: new Date().toISOString(), createdAt: prev.createdAt || new Date().toISOString() };
        await store.setJSON("quotes/" + token, { leadId: id });
        const upd = { ...lead, quote, valor: total, updatedAt: new Date().toISOString() };
        await store.setJSON("leads/" + id, upd);
        return json({ ok: true, item: upd, url: quoteUrl(quote) });
      }
      if (a === "quote-send" || a === "pay-final" || a === "pay-link") {
        if (!stripeReady()) return json({ error: "O Stripe ainda não está ligado. Falta a variável STRIPE_SECRET_KEY no Netlify." }, 500);
        const { id, lead } = await loadLead();
        if (!lead) return json({ error: "Pedido não encontrado" }, 404);
        try {
          const upd = { ...lead, payments: (lead.payments || []).map((x) => ({ ...x })), updatedAt: new Date().toISOString() };
          let pay;
          if (a === "quote-send") {
            if (!lead.quote) return json({ error: "Guarda primeiro o orçamento." }, 400);
            await cancelPending(upd, "sinal");
            const cents = Math.round(lead.quote.total * 100 / 2);
            pay = await createPay(lead, cents, "Sinal 50% · " + svcName(lead) + " · " + lead.quote.number, "sinal", quoteUrl(lead.quote) + "&pago=1");
            upd.quote = { ...lead.quote, sentAt: new Date().toISOString() };
          } else if (a === "pay-final") {
            if (!lead.quote) return json({ error: "Este pedido não tem orçamento." }, 400);
            await cancelPending(upd, "final");
            const cents = Math.round(lead.quote.total * 100) - paidOf(lead);
            if (cents < 50) return json({ error: "Não há valor em falta neste orçamento." }, 400);
            pay = await createPay(lead, cents, "Pagamento final · " + svcName(lead) + " · " + lead.quote.number, "final", quoteUrl(lead.quote) + "&pago=1");
          } else {
            const cents = Math.round(parseFloat(String(body.amount || "").replace(",", ".")) * 100);
            if (!(cents >= 50)) return json({ error: "Escreve um valor de pelo menos 0,50€." }, 400);
            pay = await createPay(lead, cents, String(body.desc || "").trim().slice(0, 200) || "Beatriz Machado", body.kind === "extra" ? "extra" : "total");
            if (!(+upd.valor > 0)) upd.valor = cents / 100;
          }
          upd.payments.push(pay);
          await store.setJSON("leads/" + id, upd);
          return json({ ok: true, item: upd, pay, url: upd.quote ? quoteUrl(upd.quote) : null });
        } catch (e) { return json({ error: "O Stripe não aceitou: " + e.message }, 502); }
      }
      if (a === "pay-cancel") {
        const id = String(body.id || "").replace(/[^\w-]/g, "");
        const lead = await store.get("leads/" + id, { type: "json" });
        const pay = lead && (lead.payments || []).find((x) => x.id === body.payId);
        if (!pay) return json({ error: "Pagamento não encontrado" }, 404);
        if (pay.status === "paid") return json({ error: "Este pagamento já foi pago." }, 400);
        if (stripeReady() && pay.link) { try { await stripe("payment_links/" + pay.link, { active: "false" }); } catch (e) { console.error(e); } }
        const upd = { ...lead, payments: lead.payments.map((x) => (x.id === pay.id ? { ...x, status: "cancelled" } : x)) };
        await store.setJSON("leads/" + id, upd);
        return json({ ok: true, item: upd });
      }
      /* equipa */
      if (a === "staff-add") {
        const name = String(body.name || "").trim().slice(0, 120), email = String(body.email || "").trim().toLowerCase().slice(0, 200);
        if (!name) return json({ error: "Escreve o nome." }, 400);
        if (!emailOk(email)) return json({ error: "Escreve um email válido." }, 400);
        if (await store.get("staffidx/" + sha(email), { type: "json" })) return json({ error: "Já existe uma pessoa com este email." }, 409);
        const m = { id: crypto.randomUUID(), name, email, createdAt: new Date().toISOString(), invitedAt: new Date().toISOString() };
        await store.setJSON("staff/" + m.id, m);
        await store.setJSON("staffidx/" + sha(email), { id: m.id });
        return json({ ok: true, staff: pubStaff(m), ...(await createInvite(store, m, req)) });
      }
      if (a === "staff-link") {
        const m = await store.get("staff/" + String(body.id || "").replace(/[^\w-]/g, ""), { type: "json" });
        if (!m) return json({ error: "Pessoa não encontrada." }, 404);
        const upd = { ...m, invitedAt: new Date().toISOString() };
        await store.setJSON("staff/" + m.id, upd);
        return json({ ok: true, staff: pubStaff(upd), ...(await createInvite(store, upd, req)) });
      }
      if (a === "staff-remove") {
        const m = await store.get("staff/" + String(body.id || "").replace(/[^\w-]/g, ""), { type: "json" });
        if (!m) return json({ ok: true });
        await store.delete("staff/" + m.id);
        await store.delete("staffidx/" + sha(m.email));
        const ag = await list(store, "agenda/");
        await Promise.all(ag.filter((x) => x.uid === m.id).map((x) => store.delete("agenda/" + x.id)));
        return json({ ok: true });
      }
      if (a === "notifs-read") {
        const ids = Array.isArray(body.ids) ? body.ids.filter((x) => /^[\w-]+$/.test(x)) : null;
        const all = await list(store, "notifs/");
        await Promise.all(all.filter((n) => !n.read && (!ids || ids.includes(n.id))).map((n) => store.setJSON("notifs/" + n.id, { ...n, read: true })));
        return json({ ok: true });
      }
      if (a === "invite") {
        const token = newToken().slice(0, 24);
        const inv = { token, createdAt: new Date().toISOString(), name: String(body.name || "").slice(0, 120), role: String(body.role || "").slice(0, 160),
          project: String(body.project || "").replace(/[^\w-]/g, "").slice(0, 60), projectName: String(body.projectName || "").slice(0, 120), phone: String(body.phone || "").slice(0, 40) };
        await store.setJSON("invites/" + token, inv);
        return json({ ok: true, invite: inv });
      }
      if (a === "testimonial") {
        const id = String(body.id || "");
        if (!/^[\w-]+$/.test(id)) return json({ error: "Dados inválidos" }, 400);
        const t = await store.get("testimonials/" + id, { type: "json" });
        if (!t) return json({ error: "Testemunho não encontrado" }, 404);
        const upd = { ...t };
        if (["approved", "hidden", "pending"].includes(body.status)) { upd.status = body.status; if (body.status === "approved" && !t.approvedAt) upd.approvedAt = new Date().toISOString(); }
        for (const k of ["quote", "name", "role"]) if (typeof body[k] === "string") upd[k] = body[k].slice(0, k === "quote" ? 1200 : 160);
        await store.setJSON("testimonials/" + id, upd);
        return json({ ok: true, item: upd });
      }
      return json({ error: "Ação desconhecida" }, 400);
    }

    const { col, item } = body || {};
    if (!(owner ? OWNER_COLS : MEMBER_COLS).has(col) || !item || typeof item !== "object") return json({ error: owner ? "Dados inválidos" : "Sem permissão." }, owner ? 400 : 403);
    const now = new Date().toISOString();
    const id = String(item.id || crypto.randomUUID()).replace(/[^\w-]/g, "").slice(0, 80);
    const prev = await store.get(col + "/" + id, { type: "json" });
    if (col === "templates" && id.startsWith("cfg-") && !owner) return json({ error: "Sem permissão." }, 403);

    if (col === "agenda") {
      if (prev && (prev.uid || "owner") !== me.uid) return json({ error: "Sem permissão." }, 403);
      const saved = { ...item, id, uid: me.uid, createdAt: (prev && prev.createdAt) || now, updatedAt: now };
      await store.setJSON("agenda/" + id, saved);
      return json({ ok: true, item: saved });
    }
    if (col === "leads" && !owner) {
      if (!prev) return json({ error: "Pedido não encontrado" }, 404);
      const upd = { ...prev, updatedAt: now };
      MEMBER_LEAD_FIELDS.forEach((k) => { if (k in item) upd[k] = item[k]; });
      await store.setJSON("leads/" + id, upd);
      return json({ ok: true, item: stripMoney(upd) });
    }
    const saved = { ...item, id, createdAt: item.createdAt || now, updatedAt: now };
    await store.setJSON(col + "/" + id, saved);
    return json({ ok: true, item: saved });
  }

  if (req.method === "DELETE") {
    const col = url.searchParams.get("col"), id = url.searchParams.get("id");
    if (!id || !/^[\w-]+$/.test(id)) return json({ error: "Dados inválidos" }, 400);
    if (col === "agenda") {
      const prev = await store.get("agenda/" + id, { type: "json" });
      if (prev && (prev.uid || "owner") !== me.uid) return json({ error: "Sem permissão." }, 403);
      await store.delete("agenda/" + id);
      return json({ ok: true });
    }
    if (col === "templates") { await store.delete("templates/" + id); return json({ ok: true }); }
    if (!owner) return json({ error: "Sem permissão." }, 403);
    if (col === "testimonials" || col === "invites") { await store.delete(col + "/" + id); return json({ ok: true }); }
    if (!OWNER_COLS.has(col)) return json({ error: "Dados inválidos" }, 400);
    if (col === "leads") {
      const lead = await store.get("leads/" + id, { type: "json" });
      if (lead && lead.userId) await store.delete("uleads/" + lead.userId + "/" + id);
    }
    await store.delete(col + "/" + id);
    return json({ ok: true });
  }

  return json({ error: "Método não permitido" }, 405);
};

export const config = { path: "/api/admin" };
