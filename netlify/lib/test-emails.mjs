// Emails de teste: envia uma cópia de todos os emails do sistema (com dados de exemplo) para o email da Beatriz.
// Os textos seguem os dos emails reais (lead.mjs, stripe-webhook.mjs, auth.mjs, admin.mjs, testimonials.mjs).
import { env, mailLayout, mailText, rows, button, p, pH, codeBox, getSignature, signatureText, sendMail, store } from "./common.mjs";
import { quotePdf, eur } from "./quote.mjs";

const T = "[TESTE] ";

export async function sendTestEmails(to, site, templates) {
  const s = store(), sig = await getSignature(s);
  const L = { nome: "Ana Exemplo", email: "ana@exemplo.pt", telefone: "+351 912 345 678", marca: "Estúdio Ana", categoria: "Websites", subcategoria: "Website Completo", mensagem: "Olá! Tenho um estúdio de yoga e preciso de um site para receber marcações." };
  const svc = "Websites — Website Completo", first = "Ana";
  const qUrl = site + "/orcamento/?t=exemplo";
  const quote = { number: "ORC-2026-000", total: 990, prazo: "Até 14 dias", validade: 15, notas: "", createdAt: new Date().toISOString(), sentAt: new Date().toISOString(),
    items: [{ d: "Website Completo", det: "Website de 3 a 12 páginas, pensado para explicar o que fazes e levar ao contacto.", q: 1, v: 990 },
      { d: "Design profissional à medida", det: "", q: 1, v: 0 }, { d: "Adaptado a telemóvel", det: "", q: 1, v: 0 }, { d: "SEO básico", det: "Títulos, descrições e estrutura para o Google.", q: 1, v: 0 }, { d: "Formulário de contacto", det: "", q: 1, v: 0 }] };
  const pdf = Buffer.from(await quotePdf({ ...L, quote }, qUrl)).toString("base64");
  const details = rows([["Nome", L.nome], ["WhatsApp", L.telefone], ["Email", L.email], ["Negócio", L.marca], ["Categoria", L.categoria], ["Subcategoria", L.subcategoria], ["Mensagem", L.mensagem]]);
  const M = []; // [para quem, assunto, html, text, anexos]
  const add = (grp, subject, html, text, attachments) => M.push({ subject: T + grp + " · " + subject, html, text: text || "", attachments });

  /* 1. Automáticos para o cliente */
  add("Cliente", "O teu orçamento · " + svc + " · " + quote.number,
    mailLayout("O teu orçamento", p(`Olá ${first},`) +
      pH(`Obrigada pelo teu pedido. Preparei já o orçamento para <b>${svc}</b>: segue em anexo em PDF e também o podes ver online.`) +
      rows([["Orçamento", quote.number], ["Serviço", "Website Completo"], ["Total", eur(quote.total)], ["Prazo", quote.prazo], ["Validade", quote.validade + " dias"]]) +
      pH("<b>Como avançar:</b> aprovas o orçamento na página, pagas 50% para reservar a data e os outros 50% só na entrega. Se quiseres ajustar alguma coisa, responde a este email ou fala comigo pelo WhatsApp.") +
      button(qUrl, "Ver e aprovar o orçamento"), sig), "Orçamento automático" + signatureText(sig), [{ filename: "Orcamento-" + quote.number + ".pdf", content: pdf }]);
  add("Cliente", "Recebi o teu pedido de orçamento",
    mailLayout("Pedido recebido", p(`Olá ${first},`) + p("Obrigada pelo teu pedido. Vou analisar o teu projeto e responder-te pelo WhatsApp ou por email em 24 a 48 horas úteis.") +
      pH("<b>Próximos passos:</b> 1. Analiso o teu pedido (e, se precisar, faço-te algumas perguntas). 2. Envio-te uma proposta com o valor, o que está incluído e o prazo. 3. Se aprovares, pagas 50% para reservar e o resto só na entrega.") + p("Pedir orçamento não te compromete a nada.") + details, sig));
  const pago = (titulo, corpo) => add("Cliente", "Pagamento recebido: o teu projeto está reservado (" + titulo + ")",
    mailLayout("Projeto reservado", p(`Olá ${first},`) + corpo.map((x) => p(x)).join("") + p("Obrigada pela confiança!"), sig));
  pago("sinal", ["Recebi o teu pagamento de 495€, o sinal de 50% do teu projeto (" + svc + "). O teu lugar na minha agenda está reservado.", "Nas próximas 24 a 48 horas entro em contacto contigo para combinarmos os detalhes e começarmos.", "Os restantes 495€ só são pagos na entrega, quando o projeto estiver pronto."]);
  pago("plano mensal", ["Recebi o teu pagamento de 59,90€, referente ao 1.º mês de Manutenção Pro (mensal).", "Nas próximas 24 a 48 horas entro em contacto contigo para combinarmos tudo e começarmos.", "Nos meses seguintes envio-te o link de pagamento no início de cada mês."]);
  pago("pagamento total", ["Recebi o teu pagamento de 990€ (" + svc + ").", "Nas próximas 24 a 48 horas entro em contacto contigo para combinarmos os próximos passos."]);

  /* 2. Automáticos para a Beatriz */
  const adm = button(site + "/admin/", "Abrir o painel");
  add("Para ti", "Novo pedido: Ana Exemplo · Ainda não sei", mailLayout("Novo pedido de orçamento", details + adm));
  add("Para ti", "Orçamento " + quote.number + " enviado · Ana Exemplo · Website Completo",
    mailLayout("Novo pedido de orçamento", pH(`Enviei automaticamente ao cliente o orçamento <b>${quote.number}</b> (${eur(quote.total)}). Podes editá-lo no painel.`) + details + adm), "", [{ filename: quote.number + ".pdf", content: pdf }]);
  add("Para ti", "Novo projeto pago: " + svc + " · 495€ · Ana Exemplo",
    mailLayout("Novo projeto pago", p("Um cliente reservou um projeto e pagou o sinal de 50%.") + rows([["Cliente", L.nome], ["Email", L.email], ["WhatsApp", L.telefone], ["Marca", L.marca], ["Serviço", svc], ["Pago agora", "495€"], ["Falta pagar", "495€ (na entrega)"], ["Mensagem", L.mensagem]]) +
      p("Próximo passo: abre o pedido no painel e carrega em «Avisar que comecei».") + adm));
  add("Para ti", "Sinal recebido: 495€ · Ana Exemplo", mailLayout("Pagamento recebido", rows([["Cliente", L.nome], ["Valor", "495€"], ["Descrição", "Sinal 50% · " + svc], ["Email", L.email]]) + adm));
  add("Para ti", "Pagamento recebido: 15€ · Idioma extra · Ana Exemplo",
    mailLayout("Pagamento recebido", rows([["Cliente", L.nome], ["Email", L.email], ["Produto", "Idioma extra"], ["Valor", "15€"]]) + p("Abre o painel, em Pagamentos, e associa este pagamento ao pedido do cliente.") + adm));
  add("Para ti", "Renovação recebida: 59,90€ · Manutenção Pro (mensal) · Ana Exemplo",
    mailLayout("Renovação recebida", rows([["Cliente", L.nome], ["Email", L.email], ["Plano", "Manutenção Pro (mensal)"], ["Valor", "59,90€"], ["Período", "dezembro de 2026"]]) + p("Já ficou registada no pedido do cliente e nas contas do painel.") + adm));
  add("Para ti", "Renovação falhou: Manutenção Pro (mensal) · Ana Exemplo",
    mailLayout("Renovação falhou", rows([["Cliente", L.nome], ["Email", L.email], ["Plano", "Manutenção Pro (mensal)"], ["Valor", "59,90€"], ["Período", "dezembro de 2026"]]) + p("O Stripe vai tentar cobrar outra vez automaticamente. Se continuar a falhar, fala com o cliente para atualizar o cartão.")));
  add("Para ti", "Novo testemunho de Ana Exemplo",
    mailLayout("Novo testemunho para aprovar", p("“Exemplo de testemunho: o processo foi simples e o resultado ficou exatamente como imaginava.”") + rows([["Nome", L.nome], ["Empresa", L.marca], ["Projeto", "Website Completo"], ["Pontuação", "5 / 5"]]) + button(site + "/admin/", "Aprovar no painel")));

  /* 3. Acesso e conta */
  add("Conta", "482913 · Confirma a tua conta", mailLayout("Confirma a tua conta", p(`Olá ${first},`) + p("Usa este código para confirmares a tua conta e enviares o teu pedido de orçamento:") + codeBox("482913") + p("O código é válido durante 15 minutos. Se não foste tu, podes ignorar este email."), sig));
  add("Conta", "482913 · Código para mudar a palavra-passe", mailLayout("Código para mudar a palavra-passe", p(`Olá ${first},`) + p("Usa este código para escolheres uma nova palavra-passe:") + codeBox("482913") + p("O código é válido durante 15 minutos. Se não foste tu, podes ignorar este email."), sig));
  add("Equipa", "Acesso ao painel do Beatriz Studio", mailLayout("Olá Sara!", p("A Beatriz deu-te acesso ao painel do estúdio. Não precisas de criar conta em lado nenhum: carrega no botão, cria a tua palavra-passe e fica feito.") + button(site + "/admin/", "Entrar no painel") + p("Também podes entrar a qualquer momento em " + site + "/admin com o teu email (sara@exemplo.pt).")));
  add("Equipa", "O teu código: 482913", mailLayout("Olá Sara!", p("Este é o teu código para criares a palavra-passe do painel. É válido durante 15 minutos.") + codeBox("482913")));

  /* 4. Modelos do painel (como saem quando os envias por email) */
  (templates || []).slice(0, 40).forEach((t, i) => {
    const subject = String(t.subject || "Beatriz Studio").slice(0, 200), text = String(t.text || "").slice(0, 8000);
    add("Modelo " + String(i + 1).padStart(2, "0") + " " + String(t.title || "").slice(0, 60), subject, mailLayout(subject, mailText(text), sig), text + signatureText(sig));
  });

  // Envio: os que têm anexo um a um; os restantes de uma vez (Resend batch).
  let ok = 0, fail = 0;
  for (const m of M.filter((x) => x.attachments)) { const r = await sendMail({ to, ...m }); r.ok ? ok++ : fail++; }
  const rest = M.filter((x) => !x.attachments);
  try {
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST", headers: { authorization: "Bearer " + env("RESEND_API_KEY"), "content-type": "application/json" },
      body: JSON.stringify(rest.map((m) => ({ from: env("MAIL_FROM"), to: [to], subject: m.subject, html: m.html, text: m.text || undefined, reply_to: env("REPLY_TO") || "beatrizmachadostudio@gmail.com" })))
    });
    if (r.ok) ok += rest.length; else { fail += rest.length; console.error("Resend batch", r.status, await r.text().catch(() => "")); }
  } catch (e) { fail += rest.length; console.error("Resend batch", e); }
  return { ok, fail, total: M.length };
}
