// API privada do painel: lista, cria, atualiza e apaga pedidos, clientes e projetos.
// Protegida pela palavra-passe definida na variável de ambiente ADMIN_PASSWORD (Netlify).
import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const COLS = new Set(["leads", "clients", "projects"]);
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k]);
const hash = (s) => createHash("sha256").update(String(s)).digest();

function authorised(req) {
  const pw = env("ADMIN_PASSWORD");
  if (!pw) return "missing";
  const given = req.headers.get("x-admin-key") || "";
  return timingSafeEqual(hash(given), hash(pw)) ? "ok" : "denied";
}

async function list(store, col) {
  const { blobs } = await store.list({ prefix: col + "/" });
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return items.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export default async (req) => {
  const auth = authorised(req);
  if (auth === "missing") return json({ error: "A variável ADMIN_PASSWORD ainda não está configurada no Netlify." }, 500);
  if (auth !== "ok") return json({ error: "Palavra-passe incorreta." }, 401);

  const store = getStore({ name: "crm", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const [leads, clients, projects] = await Promise.all([list(store, "leads"), list(store, "clients"), list(store, "projects")]);
    return json({ leads, clients, projects });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
    const { col, item } = body || {};
    if (!COLS.has(col) || !item || typeof item !== "object") return json({ error: "Dados inválidos" }, 400);
    const now = new Date().toISOString();
    const saved = { ...item, id: item.id || crypto.randomUUID(), createdAt: item.createdAt || now, updatedAt: now };
    await store.setJSON(col + "/" + saved.id, saved);
    return json({ ok: true, item: saved });
  }

  if (req.method === "DELETE") {
    const col = url.searchParams.get("col"), id = url.searchParams.get("id");
    if (!COLS.has(col) || !id || !/^[\w-]+$/.test(id)) return json({ error: "Dados inválidos" }, 400);
    await store.delete(col + "/" + id);
    return json({ ok: true });
  }

  return json({ error: "Método não permitido" }, 405);
};

export const config = { path: "/api/admin" };
