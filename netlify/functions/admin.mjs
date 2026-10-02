// API privada do painel: pedidos, clientes, projetos, contas do site e notificações.
// Protegida pela palavra-passe definida na variável de ambiente ADMIN_PASSWORD (Netlify).
import { createHash, timingSafeEqual } from "node:crypto";
import { json, env, store as getCrm, publicUser, newToken } from "../lib/common.mjs";

const COLS = new Set(["leads", "clients", "projects"]);
const hash = (s) => createHash("sha256").update(String(s)).digest();

function authorised(req) {
  const pw = env("ADMIN_PASSWORD");
  if (!pw) return "missing";
  const given = req.headers.get("x-admin-key") || "";
  return timingSafeEqual(hash(given), hash(pw)) ? "ok" : "denied";
}

async function list(store, prefix, limit) {
  const { blobs } = await store.list({ prefix });
  const keys = blobs.map((b) => b.key).sort().reverse().slice(0, limit || 1e6);
  const items = await Promise.all(keys.map((k) => store.get(k, { type: "json" })));
  return items.filter(Boolean);
}
const newest = (a, b) => String(b.createdAt || b.at).localeCompare(String(a.createdAt || a.at));

export default async (req) => {
  const auth = authorised(req);
  if (auth === "missing") return json({ error: "A variável ADMIN_PASSWORD ainda não está configurada no Netlify." }, 500);
  if (auth !== "ok") return json({ error: "Palavra-passe incorreta." }, 401);

  const store = getCrm();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const [leads, clients, projects, users, notifs, testimonials, invites] = await Promise.all([
      list(store, "leads/"), list(store, "clients/"), list(store, "projects/"), list(store, "users/"), list(store, "notifs/", 60),
      list(store, "testimonials/"), list(store, "invites/")
    ]);
    return json({
      leads: leads.sort(newest), clients: clients.sort(newest), projects: projects.sort(newest),
      users: users.filter((u) => u.status === "active").map(publicUser).sort(newest),
      notifs: notifs.sort(newest), testimonials: testimonials.sort(newest), invites: invites.sort(newest)
    });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
    if (body && body.action === "notifs-read") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x) => /^[\w-]+$/.test(x)) : null;
      const all = await list(store, "notifs/");
      await Promise.all(all.filter((n) => !n.read && (!ids || ids.includes(n.id))).map((n) => store.setJSON("notifs/" + n.id, { ...n, read: true })));
      return json({ ok: true });
    }
    if (body && body.action === "invite") {
      const token = newToken().slice(0, 24);
      const inv = { token, createdAt: new Date().toISOString(), name: String(body.name || "").slice(0, 120), role: String(body.role || "").slice(0, 160),
        project: String(body.project || "").replace(/[^\w-]/g, "").slice(0, 60), projectName: String(body.projectName || "").slice(0, 120), phone: String(body.phone || "").slice(0, 40) };
      await store.setJSON("invites/" + token, inv);
      return json({ ok: true, invite: inv });
    }
    if (body && body.action === "testimonial") {
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
    const { col, item } = body || {};
    if (!COLS.has(col) || !item || typeof item !== "object") return json({ error: "Dados inválidos" }, 400);
    const now = new Date().toISOString();
    const saved = { ...item, id: item.id || crypto.randomUUID(), createdAt: item.createdAt || now, updatedAt: now };
    await store.setJSON(col + "/" + saved.id, saved);
    return json({ ok: true, item: saved });
  }

  if (req.method === "DELETE") {
    const col = url.searchParams.get("col"), id = url.searchParams.get("id");
    if (col === "testimonials" || col === "invites") {
      if (!id || !/^[\w-]+$/.test(id)) return json({ error: "Dados inválidos" }, 400);
      await store.delete(col + "/" + id);
      return json({ ok: true });
    }
    if (!COLS.has(col) || !id || !/^[\w-]+$/.test(id)) return json({ error: "Dados inválidos" }, 400);
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
