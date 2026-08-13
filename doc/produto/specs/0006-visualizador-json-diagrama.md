# 0006 — Visualizador de JSON em diagrama de nós

- **Status:** em desenvolvimento
- **RICE:** R 9 · I 2 · C 90% · E 4 → **score 4.1**
- **Criada em:** 2026-08-12

## Contexto e problema

Todo JSON exibido no desktop hoje passa por `JsonTree` — uma árvore
recolhível, hand-rolled, sem nenhuma capacidade de edição. Está em 8 pontos
do app (Network request/response, Queries data/error, params de navegação,
Storage KV, Storage relacional, args de log). `StoresView` nem usa
`JsonTree` — mostra `<pre>{JSON.stringify(...)}}</pre>` cru, sem colapsar,
sem highlight, sem copy button.

Pedido do usuário: quer o preview de JSON parecido com
[TODiagram](https://todiagram.com/json-editor-visualization) ou a extensão
[JSON Visualizer](https://marketplace.visualstudio.com/items?itemName=haknkayaa.json-visualizer)
do VS Code — um diagrama de nós navegável, não uma árvore de texto indentada.

Esta spec cobre só a troca visual. A edição com escrita de volta pro app
conectado é a spec 0007 — deliberadamente separada, perfil de risco bem
diferente (aqui é só front-end/CSS; lá é o primeiro canal bidirecional do
protocolo).

## Personas / usuários afetados

- **Dev inspecionando um payload grande** (resposta de rede, estado
  gerenciado, storage) — quer entender a estrutura de relance, não ler uma
  árvore de texto linha por linha.
- **Dev debugando storage relacional** — já tem `SchemaDiagram` pra tabelas;
  quer a mesma linguagem visual pro conteúdo de uma célula/valor.

## Histórias de usuário

Como dev olhando uma resposta de API grande no Network, quero ver a
estrutura do JSON como um diagrama navegável, para entender rapidamente o
formato sem rolar uma árvore de texto.

Como dev com um payload muito grande (evento raro), quero que o preview
continue utilizável mesmo quando um diagrama de nós não faria sentido, para
não perder a funcionalidade que já tinha com `JsonTree`.

## Critérios de aceite

- [ ] **CA1** — Dado qualquer JSON aninhado exibido em qualquer uma das 8
      telas que hoje usam `JsonTree`, Quando a tela renderiza, Então o
      mesmo dado aparece como um diagrama de nós (`@xyflow/react` +
      `@dagrejs/dagre`, mesma stack de `GraphView`/`SchemaDiagram`) em vez
      da árvore de texto.
- [ ] **CA2** — Dado um objeto/array só de primitivos (payload "plano"),
      Quando renderizado, Então aparece como um único card sem chrome de
      canvas (sem pan/zoom/background) — não uma caixa solta flutuando num
      canvas vazio.
- [ ] **CA3** — Dado um payload maior que 256 KB serializado, Quando
      renderizado, Então o componente cai automaticamente para o
      `JsonTree` original (mantido no código como fallback interno) em vez
      de tentar desenhar um grafo grande demais.
- [ ] **CA4** — Dado um objeto/array com mais containers do que o
      orçamento de nós (`MAX_NODES = 300`), Quando renderizado, Então os
      containers restantes aparecem como linhas "colapsadas" clicáveis em
      vez de estourar o orçamento.
- [ ] **CA5** — Dado um valor circular (referência a um ancestral), Quando
      renderizado, Então aparece uma linha `[Circular]` sem gerar nó/edge
      novo, sem loop infinito.
- [ ] **CA6** — Dado o mesmo dado re-renderizado (ex.: `storage/change`
      chegando enquanto o usuário tem nós expandidos), Quando o diagrama
      re-deriva, Então os ids de nó são estáveis (baseados no path) e o
      estado de expansão do usuário não se perde.
- [ ] **CA7** — Dado um site embutido num painel lateral (Storage,
      Network, Queries), Quando o diagrama renderiza, Então tem altura
      explícita e não rouba o scroll da página ao usar a roda do mouse.

## Checklist de impacto

- **Autenticação / autorização:** n/a.
- **Isolamento de dados:** n/a — puramente visual, mesmos dados que já
  chegam ao desktop hoje.
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a.
- **Dados pessoais / privacidade:** nenhuma mudança — mesmos dados que
  `JsonTree` já exibia.
- **Notificações / comunicação externa:** n/a.
- **Interface / experiência:** é o próprio escopo da spec. Reaproveita a
  stack visual já validada em `GraphView`/`SchemaDiagram`, sem introduzir
  biblioteca nova (TODiagram é produto fechado; JSON Crack é AGPL,
  incompatível com este monorepo MIT publicado no npm).
- **Migração de dados / schema:** nenhuma — não toca o wire protocol.
- **Compatibilidade / integração externa:** `JsonTree.tsx` não é removido,
  vira o fallback interno de payloads grandes — nenhum consumidor externo
  (não há nenhum; é um componente interno do desktop).
- **Performance / escala:** React Flow não tem virtualização — todo nó é
  DOM real. Mitigado por CA3 (fallback por tamanho) e CA4 (orçamento de
  nós); sem isso, um payload grande travaria a webview.

## Fora de escopo

- Qualquer capacidade de edição — spec 0007.
- Extração de um componente `<DiagramCanvas>` compartilhado entre
  `GraphView`/`SchemaDiagram`/`JsonGraph` — só o cálculo de layout dagre é
  extraído (`apps/desktop/src/lib/dagreLayout.ts`); retrofitar os outros
  dois consumidores fica pra um diff separado e independente.
- Posições de nó persistidas entre sessões.

## Riscos e dependências

- Depende só de bibliotecas já instaladas (`@xyflow/react`,
  `@dagrejs/dagre`) — sem dependência nova.
- Maior risco é de CSS/UX: 8 call sites com contextos de layout bem
  diferentes (painel lateral estreito vs. detalhe de tela cheia) — espera-se
  iteração visual, especialmente no cell relacional do Storage
  (`StorageView.tsx`, painel de detalhe estreito).

## Métrica de sucesso

Um dev consegue entender a estrutura de qualquer JSON exibido no app sem
precisar expandir manualmente uma árvore de texto linha por linha —
validado abrindo as 8 telas trocadas com dados reais e confirmando que o
diagrama comunica a estrutura tão bem ou melhor que a árvore anterior, sem
nenhuma regressão de performance perceptível.

## Plano de teste

- **Automatizado:** `buildJsonGraph.test.ts` — objeto plano → 1 nó/0 edges;
  aninhado → nó pai + filho + edge; array de primitivos inline; array de
  objetos → N nós filhos; ciclo → linha `[Circular]`, termina; orçamento de
  nós respeitado; ids estáveis entre dois builds de dados estruturalmente
  iguais; `defaultExpandDepth` respeitado; input grande cai pro modo árvore.
- **Manual/ao vivo:** passar pelas 8 telas trocadas com dados reais (Network
  incluindo uma resposta grande pra disparar CA3, Queries, params de
  navegação, Storage KV e relacional, args de log) — conferir altura, tema
  escuro, e que nenhum canvas embutido rouba o scroll da página (CA7).
