// Recebe os pedidos de orçamento do site e guarda-os na base de dados (Netlify Blobs).
import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const clean = (v, max = 2000) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  if (body["bot-field"]) return json({ ok: true }); // spam: fingimos sucesso

  const lead = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    type: body.type === "design-partner" ? "design-partner" : "proposta",
    nome: clean(body.nome, 200),
    email: clean(body.email, 200).toLowerCase(),
    marca: clean(body.marca, 200),
    servico: clean(body.servico, 200),
    extras: clean(body.extras, 1000),
    total: clean(body.total, 200),
    mensagem: clean(body.mensagem, 4000),
    status: "novo",
    notes: ""
  };
  if (!lead.nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return json({ error: "Nome e email são obrigatórios" }, 400);

  const store = getStore({ name: "crm", consistency: "strong" });
  await store.setJSON("leads/" + lead.id, lead);
  return json({ ok: true, id: lead.id });
};

export const config = { path: "/api/lead" };
