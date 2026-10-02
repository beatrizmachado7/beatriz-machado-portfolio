// Estado da configuração (sem revelar segredos): ajuda o painel a mostrar o que falta configurar.
import { json, env, store, mailReady } from "../lib/common.mjs";

export default async () => {
  let db = false;
  try { await store().get("health"); db = true; } catch (e) { console.error("Blobs", e); }
  return json({ admin: !!env("ADMIN_PASSWORD"), db, email: mailReady(), notify: !!env("NOTIFY_EMAIL") });
};

export const config = { path: "/api/status" };
