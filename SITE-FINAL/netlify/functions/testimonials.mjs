// Testemunhos de clientes.
// GET  /api/testimonials            → testemunhos aprovados (público, usado pelo site)
// GET  /api/testimonials?token=…    → valida o link pessoal enviado ao cliente
// POST /api/testimonials            → o cliente envia o testemunho (fica pendente até a Beatriz aprovar)
import { json, clean, store, limited, notify, sendMail, mailLayout, p, rows, button, env, siteUrl, ip } from "../lib/common.mjs";

const pub = (t) => ({ id: t.id, quote: t.quote, name: t.name, role: t.role, rating: t.rating || 0, photo: t.photo || "", project: t.project || "", createdAt: t.createdAt });

export default async (req) => {
  const s = store();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const token = url.searchParams.get("token");
    if (token) {
      if (!/^[\w-]{10,64}$/.test(token)) return json({ error: "Este link não é válido." }, 404);
      const inv = await s.get("invites/" + token, { type: "json" });
      if (!inv) return json({ error: "Este link não é válido." }, 404);
      if (inv.usedAt) return json({ error: "Este link já foi usado. Obrigada pelo teu testemunho!" }, 410);
      return json({ ok: true, name: inv.name || "", role: inv.role || "", project: inv.project || "", projectName: inv.projectName || "" });
    }
    const { blobs } = await s.list({ prefix: "testimonials/" });
    const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
    const items = all.filter((t) => t && t.status === "approved").sort((a, b) => String(a.order ?? a.approvedAt).localeCompare(String(b.order ?? b.approvedAt))).map(pub);
    return new Response(JSON.stringify({ items }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" } });
  }

  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  if (b["bot-field"]) return json({ ok: true });
  if (await limited(s, "testi-ip:" + ip(req), 10, 36e5)) return json({ error: "Demasiadas tentativas. Tenta mais tarde." }, 429);

  const token = String(b.token || "");
  if (!/^[\w-]{10,64}$/.test(token)) return json({ error: "Este link não é válido." }, 404);
  const inv = await s.get("invites/" + token, { type: "json" });
  if (!inv) return json({ error: "Este link não é válido." }, 404);
  if (inv.usedAt) return json({ error: "Este link já foi usado." }, 410);

  const t = {
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: "pending",
    quote: clean(b.quote, 1200), name: clean(b.name, 120), role: clean(b.role, 160),
    rating: Math.max(0, Math.min(5, parseInt(b.rating, 10) || 0)),
    photo: "", project: inv.project || "", projectName: inv.projectName || "", consent: b.consent === true, invite: token
  };
  if (t.quote.length < 20) return json({ error: "Escreve pelo menos uma frase sobre a tua experiência." }, 400);
  if (!t.name) return json({ error: "Escreve o teu nome." }, 400);
  if (!t.consent) return json({ error: "Para publicar o testemunho, preciso da tua autorização." }, 400);
  const photo = String(b.photo || "");
  if (photo) {
    if (!/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 200000) return json({ error: "A imagem não é válida. Experimenta outra ou envia sem imagem." }, 400);
    t.photo = photo;
  }

  await s.setJSON("testimonials/" + t.id, t);
  await s.setJSON("invites/" + token, { ...inv, usedAt: t.createdAt, testimonialId: t.id });
  await notify(s, { type: "testimonial", title: "Novo testemunho para aprovar", sub: `${t.name}${t.role ? " · " + t.role : ""}`, testimonialId: t.id });
  if (env("NOTIFY_EMAIL")) {
    await sendMail({
      to: env("NOTIFY_EMAIL"), subject: `Novo testemunho de ${t.name}`,
      html: mailLayout("Novo testemunho para aprovar", p(`“${t.quote}”`) + rows([["Nome", t.name], ["Empresa", t.role], ["Projeto", t.projectName], ["Pontuação", t.rating ? t.rating + " / 5" : ""]]) + button(siteUrl(req) + "/admin/", "Aprovar no painel")),
      text: `Novo testemunho de ${t.name}:\n\n“${t.quote}”\n\nAprova no painel: ${siteUrl(req)}/admin/`
    });
  }
  return json({ ok: true });
};

export const config = { path: "/api/testimonials" };
