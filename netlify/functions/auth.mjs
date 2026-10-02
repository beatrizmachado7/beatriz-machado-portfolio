// Contas de cliente: criar conta, confirmar por código, entrar, recuperar palavra-passe e "A minha conta".
import {
  json, clean, sha, store, emailOk, phoneOk, userKey, ip, hashPw, checkPw, newCode,
  createSession, sessionUser, publicUser, limited, notify, mailReady, sendMail, mailLayout, p, codeBox
} from "../lib/common.mjs";

const CODE_MIN = 15;

async function sendCode(user, code, kind) {
  const reset = kind === "reset";
  const subject = reset ? "Código para mudar a palavra-passe" : "Confirma a tua conta";
  const html = mailLayout(subject,
    p(`Olá ${user.nome.split(" ")[0]},`) +
    p(reset ? "Usa este código para escolheres uma nova palavra-passe:" : "Usa este código para confirmares a tua conta e enviares o teu pedido de orçamento:") +
    codeBox(code) +
    p(`O código é válido durante ${CODE_MIN} minutos. Se não foste tu, podes ignorar este email.`));
  const text = `${subject}\n\nCódigo: ${code}\n\nVálido durante ${CODE_MIN} minutos.`;
  return sendMail({ to: user.email, subject: `${code} · ${subject}`, html, text });
}

async function myLeads(s, user) {
  const { blobs } = await s.list({ prefix: "uleads/" + user.id + "/" });
  const leads = await Promise.all(blobs.map((b) => s.get("leads/" + b.key.split("/").pop(), { type: "json" })));
  return leads.filter(Boolean)
    .map((l) => ({ id: l.id, createdAt: l.createdAt, type: l.type, servico: l.servico, extras: l.extras, total: l.total, status: l.status }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export default async (req) => {
  const s = store();

  if (req.method === "GET") {
    const ses = await sessionUser(req, s);
    if (!ses) return json({ error: "Sessão terminada. Entra outra vez." }, 401);
    return json({ user: publicUser(ses.user), leads: await myLeads(s, ses.user) });
  }
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  let b;
  try { b = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  const action = String(b.action || "");
  const email = clean(b.email, 200).toLowerCase();

  if (action === "logout") {
    const ses = await sessionUser(req, s);
    if (ses) await s.delete(ses.key);
    return json({ ok: true });
  }

  if (action === "register") {
    if (b["bot-field"]) return json({ ok: true, verify: true });
    const nome = clean(b.nome, 120), telefone = clean(b.telefone, 40), marca = clean(b.marca, 120), pw = String(b.password || "");
    if (!nome) return json({ error: "Escreve o teu nome." }, 400);
    if (!emailOk(email)) return json({ error: "Escreve um email válido." }, 400);
    if (!phoneOk(telefone)) return json({ error: "Escreve um número de telemóvel válido." }, 400);
    if (pw.length < 8) return json({ error: "A palavra-passe precisa de ter pelo menos 8 caracteres." }, 400);
    if (await limited(s, "reg:" + ip(req), 8, 36e5)) return json({ error: "Demasiadas tentativas. Tenta de novo daqui a uma hora." }, 429);

    const key = userKey(email);
    const existing = await s.get(key, { type: "json" });
    if (existing && existing.status === "active") return json({ error: "Já existe uma conta com este email. Entra com a tua palavra-passe." }, 409);

    const user = {
      id: existing?.id || sha(email).slice(0, 24), nome, email, telefone, marca,
      pw: hashPw(pw), status: "pending", createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (!mailReady()) {
      // Sem serviço de email configurado: a conta fica logo ativa para não bloquear pedidos.
      user.status = "active"; user.verifiedAt = new Date().toISOString();
      await s.setJSON(key, user);
      await notify(s, { type: "account", title: "Nova conta de cliente", sub: `${nome} · ${email}` });
      return json({ ok: true, token: await createSession(s, user), user: publicUser(user) });
    }
    const code = newCode();
    user.code = { hash: sha(email + ":" + code), exp: Date.now() + CODE_MIN * 6e4, tries: 0, kind: "verify", sentAt: Date.now() };
    await s.setJSON(key, user);
    const sent = await sendCode(user, code, "verify");
    if (!sent.ok) return json({ error: "Não foi possível enviar o email com o código. Tenta outra vez daqui a pouco." }, 502);
    return json({ ok: true, verify: true });
  }

  if (action === "verify" || action === "reset") {
    const code = clean(b.code, 12).replace(/\D/g, "");
    const key = userKey(email);
    const user = await s.get(key, { type: "json" });
    const want = action === "verify" ? "verify" : "reset";
    if (!user || !user.code || user.code.kind !== want) return json({ error: "Pede um novo código." }, 400);
    if (user.code.exp < Date.now()) return json({ error: "O código expirou. Pede um novo." }, 400);
    if (user.code.tries >= 5) return json({ error: "Demasiadas tentativas. Pede um novo código." }, 429);
    if (sha(email + ":" + code) !== user.code.hash) {
      user.code.tries++; await s.setJSON(key, user);
      return json({ error: "Código incorreto." }, 400);
    }
    if (action === "reset") {
      const pw = String(b.password || "");
      if (pw.length < 8) return json({ error: "A palavra-passe precisa de ter pelo menos 8 caracteres." }, 400);
      user.pw = hashPw(pw);
    }
    const wasPending = user.status !== "active";
    delete user.code; user.status = "active"; user.verifiedAt = user.verifiedAt || new Date().toISOString();
    await s.setJSON(key, user);
    if (wasPending) await notify(s, { type: "account", title: "Nova conta de cliente", sub: `${user.nome} · ${user.email}` });
    return json({ ok: true, token: await createSession(s, user), user: publicUser(user) });
  }

  if (action === "resend" || action === "forgot") {
    const key = userKey(email);
    const user = await s.get(key, { type: "json" });
    const kind = action === "resend" ? "verify" : "reset";
    const valid = user && (kind === "verify" ? user.status === "pending" : user.status === "active");
    if (valid && mailReady()) {
      if (user.code && Date.now() - (user.code.sentAt || 0) < 60e3) return json({ error: "Espera um minuto antes de pedires outro código." }, 429);
      if (await limited(s, "code:" + email, 6, 36e5)) return json({ error: "Demasiados códigos pedidos. Tenta mais tarde." }, 429);
      const code = newCode();
      user.code = { hash: sha(email + ":" + code), exp: Date.now() + CODE_MIN * 6e4, tries: 0, kind, sentAt: Date.now() };
      await s.setJSON(key, user);
      await sendCode(user, code, kind);
    }
    if (kind === "reset" && !mailReady()) return json({ error: "A recuperação por email ainda não está disponível. Fala comigo pelo WhatsApp." }, 503);
    return json({ ok: true }); // resposta igual exista ou não a conta
  }

  if (action === "login") {
    const pw = String(b.password || "");
    if (!emailOk(email) || !pw) return json({ error: "Escreve o teu email e a palavra-passe." }, 400);
    if (await limited(s, "login:" + email, 10, 15 * 6e4)) return json({ error: "Demasiadas tentativas. Espera 15 minutos." }, 429);
    const key = userKey(email);
    const user = await s.get(key, { type: "json" });
    if (!user || !checkPw(pw, user.pw)) return json({ error: "Email ou palavra-passe incorretos." }, 401);
    if (user.status !== "active") {
      if (mailReady()) {
        const code = newCode();
        user.code = { hash: sha(email + ":" + code), exp: Date.now() + CODE_MIN * 6e4, tries: 0, kind: "verify", sentAt: Date.now() };
        await s.setJSON(key, user);
        await sendCode(user, code, "verify");
        return json({ ok: true, verify: true });
      }
      user.status = "active"; await s.setJSON(key, user);
    }
    return json({ ok: true, token: await createSession(s, user), user: publicUser(user) });
  }

  return json({ error: "Ação desconhecida" }, 400);
};

export const config = { path: "/api/auth" };
