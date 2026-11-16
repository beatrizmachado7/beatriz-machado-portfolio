// Devolve o PDF de um orçamento a partir do link secreto (/api/quote-pdf?t=TOKEN).
import { store, siteUrl } from "../lib/common.mjs";
import { quotePdf } from "../lib/quote.mjs";

export default async (req) => {
  const t = String(new URL(req.url).searchParams.get("t") || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
  if (!t) return new Response("Link inválido", { status: 400 });
  const s = store();
  const ref = await s.get("quotes/" + t, { type: "json" });
  const lead = ref && (await s.get("leads/" + ref.leadId, { type: "json" }));
  if (!lead || !lead.quote || lead.quote.token !== t) return new Response("Orçamento não encontrado", { status: 404 });
  const bytes = await quotePdf(lead, siteUrl(req) + "/orcamento/?t=" + t);
  return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Orcamento-${lead.quote.number}.pdf"`, "cache-control": "private, no-store" } });
};

export const config = { path: "/api/quote-pdf" };
