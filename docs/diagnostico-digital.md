# Diagnóstico Digital — rascunho para o painel

Fluxo reutilizável para preparar, com a Claude, o **Diagnóstico Digital Gratuito** pedido em `beatrizstudio.pt/diagnostico-digital/`.
A Claude prepara; **a Beatriz revê, aprova e envia**. O painel não envia nenhum diagnóstico sem aprovação.

## Passo a passo

1. **Chega o pedido.** Aparece no painel, no separador «Diagnósticos», com o estado **Novo**. Recebes um email e o cliente recebe a confirmação de receção.
2. **Abre o pedido** e carrega em **«Copiar pedido para a Claude»**. Muda o estado para **Em análise**.
3. **Na Claude** (projeto *Digital Audit & Sales Strategist*), cola o pedido. A Claude:
   - analisa apenas o que está publicamente acessível (website ou Instagram). Se não conseguir abrir a página, pede capturas de ecrã;
   - entrega a **avaliação interna** (não vai para o cliente);
   - entrega o **bloco JSON** do relatório (formato abaixo).
4. **No painel**, cola o JSON em «Rascunho do relatório» e carrega em **Guardar rascunho** → estado **Rascunho pronto**.
5. **Junta as imagens** (opcional), em «Imagens do relatório»: a captura do site ou Instagram do cliente (aparece na capa) e a imagem da sugestão visual. Aceita JPG, PNG ou WebP; o painel reduz o tamanho sozinho.
6. **Lê o PDF** («Ver PDF (rascunho)»). Corrige o que for preciso diretamente no JSON e guarda outra vez.
7. **Aprova** («Aprovar diagnóstico») → estado **Aprovado**. Qualquer alteração depois disto (texto ou imagens) anula a aprovação.
8. **Envia** («Enviar ao cliente por email»): segue o email de entrega com o PDF em anexo → estado **Entregue**. Se o serviço de email falhar, o painel avisa e o estado não muda.
9. Depois, marca à mão: **Proposta pedida**, **Convertido** ou **Fechado**.

## O PDF

Usa os tipos de letra da marca (Outfit, Inclusive Sans e Instrument Serif Italic), as cores do Brandbook, o logótipo e o teu retrato no fecho. Sem imagens carregadas, a capa mostra o índice do documento. A captura só deve mostrar o que é público no site ou perfil do cliente.

## Estados

`new` Novo → `in_review` Em análise → `draft_ready` Rascunho pronto → `approved` Aprovado → `delivered` Entregue → `proposal_requested` Proposta pedida → `converted` Convertido / `closed` Fechado

- «Aprovado» só se atinge com o botão de aprovar (com confirmação).
- «Entregue» só depois de aprovado (pelo envio por email, ou à mão se entregaste por outro meio).

## Formato do rascunho (JSON)

```json
{
  "materiais": ["https://exemplo.pt/ (página inicial e serviços, vistas em 16/11/2026)"],
  "introducao": "Um parágrafo curto, em primeira pessoa.",
  "presenca": "Como o negócio se apresenta hoje online, com base no que foi visto.",
  "pontosFortes": ["O que já funciona (até 4)"],
  "melhorias": [
    { "titulo": "…", "observacao": "O que observei (facto visível)", "importancia": "Porque importa", "acao": "Como melhorar", "prioridade": "alta" },
    { "titulo": "…", "observacao": "…", "importancia": "…", "acao": "…", "prioridade": "média" },
    { "titulo": "…", "observacao": "…", "importancia": "…", "acao": "…", "prioridade": "baixa" }
  ],
  "sugestaoVisual": { "titulo": "Opcional", "descricao": "Só quando fizer sentido e for viável." },
  "proximosPassos": ["Até 5 ações, por ordem de prioridade"],
  "servico": { "nome": "Landing Page", "porque": "Opcional. Só se resolver uma necessidade real.", "preco": "490 €" },
  "notaAmbito": "Opcional: o que não foi possível verificar.",
  "email": { "assunto": "O teu diagnóstico digital · Nome do negócio", "texto": "Olá …,\n\n…\n\nBeatriz" }
}
```

Regras verificadas pelo painel ao guardar:

- exatamente **3 melhorias**, cada uma com título, observação e ação;
- `materiais` preenchido (o que foi realmente analisado);
- `servico.nome`, se existir, tem de ser do catálogo: Landing Page, Website Completo, Loja Online, Logótipo, Identidade Visual Completa, Rebranding, Templates de Websites;
- introdução, presença atual, próximos passos e email de entrega obrigatórios.

Regras que só a revisão humana garante (lê sempre antes de aprovar):

- todas as observações têm de corresponder a algo que se vê nos materiais analisados;
- sem métricas inventadas (tráfego, conversões, velocidade, rankings, testes técnicos);
- sem prazos nem resultados prometidos; preços apenas os do catálogo em vigor;
- português de Portugal, primeira pessoa do singular, sem linguagem de agência.

## Instrução para a Claude (colar uma vez no projeto)

> Quando eu colar um «Novo pedido de Diagnóstico Digital Gratuito», aplica o documento do projeto e entrega duas coisas: (1) a avaliação interna; (2) um bloco de código JSON com o formato de `docs/diagnostico-digital.md`, pronto a colar no painel. Baseia cada observação apenas no que conseguiste realmente ver e enumera em `materiais` as páginas ou perfis analisados e a data. Se não conseguires aceder ao website ou ao Instagram, diz-me e pede capturas de ecrã em vez de supor. Não inventes métricas, resultados de testes, prazos nem preços. O serviço recomendado é opcional e tem de constar do catálogo. Eu revejo e aprovo sempre antes de enviar.
