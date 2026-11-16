# Beatriz Machado — Portfólio + Painel

- `index.html` — o site (com "A minha conta" para os clientes).
- `admin/index.html` — o painel privado (beatrizstudio.pt/admin).
- `netlify/functions/auth.mjs` — contas de cliente: criar conta, código por email, entrar, recuperar palavra-passe.
- `netlify/functions/lead.mjs` — recebe os pedidos de orçamento (só com sessão iniciada) e envia os emails.
- `netlify/functions/admin.mjs` — API privada do painel (protegida por palavra-passe).
- `netlify/functions/status.mjs` — diz ao painel o que falta configurar.
- `netlify/lib/common.mjs` — funções partilhadas.
- `package.json` / `netlify.toml` — configuração do Netlify.

## Variáveis no Netlify
Project configuration → Environment variables → Add a variable. Depois de criar ou mudar variáveis, faz **Deploys → Trigger deploy**.

| Variável | Para quê | Exemplo |
|---|---|---|
| `ADMIN_PASSWORD` | Palavra-passe do painel (obrigatória) | uma palavra-passe longa e só tua |
| `RESEND_API_KEY` | Enviar emails (códigos e avisos) | `re_...` (da conta Resend) |
| `MAIL_FROM` | Remetente dos emails | `Beatriz Machado Studio <ola@beatrizstudio.pt>` |
| `NOTIFY_EMAIL` | Onde recebes o aviso de cada pedido | o teu email pessoal |
| `REPLY_TO` | Para onde vão as respostas aos emails automáticos (opcional) | `beatrizmachadostudio@gmail.com` (já é o valor por defeito) |
| `SITE_URL` | Endereço do site nos emails (opcional) | `https://beatrizstudio.pt` |

Sem `RESEND_API_KEY`/`MAIL_FROM`, o site continua a funcionar: as contas ficam ativas sem código e não são enviados emails.

## Resend (emails) — uma vez
1. Cria conta grátis em resend.com.
2. Domains → Add domain → `beatrizstudio.pt`.
3. O Resend mostra registos DNS (TXT/MX). No Netlify: Domain management → beatrizstudio.pt → DNS settings → Add new record, e copia cada um.
4. Quando o domínio ficar "Verified", vai a API Keys → Create API key e copia a chave para `RESEND_API_KEY`.

## Como funciona
1. O cliente pede orçamento em /contacto/ (3 passos, sem conta obrigatória). Anti-spam invisível: campo armadilha, tempo mínimo e máx. 6 pedidos por hora por dispositivo.
2. Quem quiser pode criar conta (com código por email) para acompanhar os pedidos em "A minha conta".
3. O pedido fica guardado (Netlify Blobs), aparece no painel com notificação (sino, som e alerta no computador) e recebes um email.
4. O cliente vê o estado do pedido em "A minha conta"; muda sempre que alteras o estado no painel.

## Testemunhos
1. No painel → Testemunhos → "Pedir testemunho" (ou, num projeto entregue, "Pedir testemunho").
2. Envia o link pessoal ao cliente (botão do WhatsApp). Cada link só pode ser usado uma vez.
3. O cliente escreve o testemunho, a pontuação e a foto/logótipo e autoriza a publicação.
4. Recebes notificação (sino + email). Carregas em "Aprovar e publicar" e aparece no site (página inicial e página do projeto).
- `netlify/functions/testimonials.mjs` — página do cliente e lista pública de testemunhos aprovados.

## Google Analytics 4 (opcional)
1. Em analytics.google.com cria uma propriedade "Beatriz Machado Studio" e um fluxo Web para https://beatrizstudio.pt.
2. Copia o ID de medição (G-XXXXXXX) e envia-o à Claude. Fica guardado nos dados do site (`meta.ga4`).
3. Com o ID definido, aparece o aviso de cookies. O Analytics só é carregado se o visitante aceitar.
4. Eventos enviados: `cta_pedir_orcamento`, `whatsapp_click`, `form_step` e `generate_lead` (com o valor estimado em €).
   No GA4, marca `generate_lead` como evento-chave (conversão).

## Email de contacto
O site mostra beatrizmachadostudio@gmail.com. Os emails automáticos saem de ola@beatrizstudio.pt (domínio verificado no Resend) e as respostas dos clientes vão para beatrizmachadostudio@gmail.com.

## Diagnóstico Digital Gratuito
- `diagnostico-digital/index.html` — a landing page (beatrizstudio.pt/diagnostico-digital/). Usa `assets/site.css` + `assets/diagnostico.css` e `assets/diagnostico.js` (não carrega `site.js`).
- `netlify/functions/diagnostico.mjs` — recebe o pedido (`/api/diagnostico`), valida no servidor, guarda-o junto dos outros pedidos com o estado «Novo», cria a notificação no painel e envia os emails (confirmação ao cliente + aviso para `NOTIFY_EMAIL`).
- `netlify/lib/diagnostico.mjs` — estados, validação, formato do rascunho e o PDF do relatório.
- `netlify/functions/admin.mjs` — ações `diag-status`, `diag-draft`, `diag-approve`, `diag-pdf` e `diag-send` (só a dona).
- `docs/diagnostico-digital.md` — o fluxo de trabalho com a Claude e o formato do rascunho.

Como funciona:
1. O formulário só mostra «Pedido recebido!» depois de o servidor confirmar que o pedido ficou guardado.
2. Anti-spam: campo armadilha, tempo mínimo, máx. 5 pedidos por hora por dispositivo e 4 por dia por email.
3. Sem duplicados: o mesmo email + o mesmo website/Instagram não criam um segundo pedido enquanto o primeiro estiver aberto.
4. No painel (separador «Diagnósticos»): colar o rascunho, ver o PDF, aprovar e enviar. Sem aprovação, o envio é recusado pelo servidor.
5. Se o Resend der erro, o pedido fica guardado na mesma, o painel assinala que a confirmação não foi enviada e nada é marcado como enviado.
6. Os dados servem apenas para o diagnóstico: ninguém é inscrito em listas de marketing.

Não precisa de variáveis novas: usa `RESEND_API_KEY`, `MAIL_FROM`, `NOTIFY_EMAIL`, `REPLY_TO`, `SITE_URL` e `ADMIN_PASSWORD`.

Eventos (enviados só se o Google Analytics já estiver carregado na página): `diagnostico_cta_click`, `diagnostico_form_start`, `diagnostico_form_erro`, `diagnostico_faq`, `generate_lead` (com `lead_type: diagnostico_digital`).
