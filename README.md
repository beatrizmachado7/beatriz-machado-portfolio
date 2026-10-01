# Beatriz Machado — Portfólio + Painel

- `index.html` — o site.
- `admin/index.html` — o painel privado (abre em `teusite.netlify.app/admin`).
- `netlify/functions/lead.mjs` — recebe os pedidos de orçamento do site e guarda-os.
- `netlify/functions/admin.mjs` — API privada do painel (protegida por palavra-passe).
- `package.json` / `netlify.toml` — configuração do Netlify.

## Configurar a palavra-passe do painel (obrigatório, uma vez)
Netlify → o teu site → Site configuration → Environment variables → Add a variable
- Key: `ADMIN_PASSWORD`
- Value: a tua palavra-passe (longa e só tua)
Depois faz um novo deploy (Deploys → Trigger deploy).

## Como funciona
1. Um cliente pede orçamento no site.
2. O pedido é guardado na base de dados do Netlify (Netlify Blobs) e aparece no painel.
3. O Netlify Forms continua a enviar-te o aviso por email.
