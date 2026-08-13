# 0011 — Destaque em telas editáveis + correlação Network↔Queries/Storage

- **Status:** em desenvolvimento
- **RICE:** R 7 · I 2 · C 85% · E 3 → **score 4.0**
- **Criada em:** 2026-08-13

## Contexto e problema

Duas lacunas de UX apontadas pelo usuário junto com o pedido da spec 0010:

1. "toda tela que tivesse possibilidade de editar teria que ter um destaque
   e um aviso de como funciona." Hoje (mesmo antes desta spec) Storage e
   Stores já têm escrita ao vivo, e Memory já tem uma ação de clear-cache —
   mas nenhuma das três sinaliza isso visualmente além da presença do
   próprio controle. Um dev que nunca leu o README pode não perceber que
   editar um valor ali afeta o app conectado de verdade, ao vivo e
   imediatamente.
2. "em network deve fazer relação com queries e storage. para que a pessoa
   saiba onde ela pode editar os dados." As três views (Network, Queries,
   Storage) são hoje ilhas completamente isoladas — nenhum campo comum no
   protocolo, nenhuma tentativa de correlação. Um request de rede que
   alimentou uma query, ou que gravou um valor em storage, não tem nenhum
   link visível até a query/key correspondente.

Diferente da spec 0010, este trabalho é **100% `apps/desktop`** — nenhuma
mudança em `packages/protocol`/`packages/sdk`. Pode ser lançado
independentemente, inclusive antes da 0010 (o banner de destaque já se
aplica a Storage/Stores/Memory, que já existiam).

**Decisão de abordagem para a correlação** (tomada com o usuário): heurística
no lado desktop, sem mudar protocolo, no mesmo espírito de
`views/storage/inferForeignKeys.ts` — ambiguidade não resolvida vira
silêncio, nunca um palpite. Duas fontes de sinal, já disponíveis sem
mudança de wire:

- **Substring**: tokens da URL (só o `pathname`, nunca host/querystring) vs.
  tokens do `queryKey`/da storage key.
- **Timing**: `entry.startedAt + durationMs` vs. o último `envelope.ts`
  (relógio do device) em que aquela query/key mudou — um dado que já
  chegava em todo envelope, mas que o desktop descartava ao aplicar
  `query/change`/`storage/change` no `AppData`.

Token overlap é sempre obrigatório; timing só desempata quando dois
candidatos têm força de token igual.

## Histórias de usuário

Como dev novo na ferramenta, quero ver claramente quando uma tela deixa eu
editar dados de verdade no app conectado, para não editar algo por engano
achando que é só uma visualização.

Como dev olhando um request de rede, quero ver se ele corresponde a uma
query ou a uma chave de storage já visíveis no Spyglass, para saber
imediatamente onde posso ir editar aquele dado.

## Decisões de design

- **Banner dispensável + destaque estrutural permanente.** O
  `LiveEditBanner` explica ("editar aqui grava no app conectado") e pode
  ser dispensado por `noticeId` (persistido); um `.live-edit-accent`
  (borda esquerda de accent color) fica no container editável
  independente do dispensar — assim a tela continua lendo como "editável"
  mesmo depois que a explicação some. Aplicado a Storage, Stores, Queries
  (nova, spec 0010) e Memory — as 4 telas com alguma forma de mutação ao
  vivo hoje.
- **Correlação só Network → Queries/Storage, não bidirecional** (decisão
  explícita do usuário) — Network é o hub; Queries/Storage não ganham link
  de volta nesta v1.
- **Navegação cross-view via `pendingHighlight`**: um campo efêmero no
  `ConnectionState` (não por-app, como `activeTab`), setado por
  `highlightAndNavigate({ tab, queryHash? | storageKey? })`, consumido uma
  única vez pela view alvo (seleciona o item, aplica a classe
  `.row-highlighted` já usada por `RelationalStorage.navigateToRelated`
  por ~1800ms) e limpo em seguida.

## Critérios de aceite

- [ ] **CA1** — Dado `canWrite`/`canClear` verdadeiro em Storage, Stores,
      Queries ou Memory, Quando o dev abre a tela, Então vê o
      `LiveEditBanner` com um texto específico daquela tela, e uma borda
      de destaque (`.live-edit-accent`) no container editável.
- [ ] **CA2** — Dado que o dev dispensa o banner numa tela, Quando ele
      volta pra essa mesma tela depois, Então o banner não reaparece — mas
      o destaque estrutural (borda) continua visível. Dispensar em uma
      tela não afeta as outras (`noticeId` por tela).
- [ ] **CA3** — Dado um request de Network cujo path compartilha tokens com
      o `queryKey` de uma query em cache (ex.: URL `/users/42` e
      `queryKey: ["users", 42]`), Quando o dev abre o detalhe desse
      request, Então aparece uma seção "Related" com um chip "Query: ...".
- [ ] **CA4** — Dado o mesmo caso para uma storage key (ex.: URL
      `/cart/items` e key `cart_items`), Então aparece um chip
      "Storage: cart_items (asyncStorage)".
- [ ] **CA5** — Dado um clique num chip, Quando a navegação acontece,
      Então a aba correspondente abre, o item é selecionado, e recebe um
      pulso de destaque (~1800ms) — mesmo padrão visual de
      `navigateToRelated` em Storage.
- [ ] **CA6** — Dado dois candidatos igualmente fortes em overlap de
      tokens e sem sinal de timing pra desempatar, Quando a correlação
      roda, Então a seção "Related" **não aparece** para esse domínio —
      silêncio em vez de um link possivelmente errado.
- [ ] **CA7** — Dado um request órfão (sem request correspondente, `url`
      literal `"?"`), Quando a correlação roda, Então ele é excluído sem
      erro, sem seção "Related".

## Checklist de impacto

- **Migração de dados / schema:** nenhuma no protocolo — `queriesMeta`/
  `storageMeta` são bookkeeping puramente desktop-side (`AppData`, nunca
  no wire).
- **Interface / experiência:** central ao pedido — ver "Decisões de
  design".
- **Performance / escala:** `correlateNetworkEntry` roda via `useMemo` só
  quando o request selecionado muda; custo é proporcional ao número de
  queries/keys em cache no momento (centenas, não milhares, na prática).
- **Compatibilidade / integração externa:** nenhuma — não depende de
  versão de SDK, só do desktop já ter o dado em memória (view-to-view).

## Fora de escopo

- Link reverso Queries/Storage → Network (decisão explícita: só uma
  direção nesta v1).
- Persistir a correlação entre reconexões — `queriesMeta`/`storageMeta`
  são estado de sessão, como o resto do `AppData`; um reload do desktop
  reseta o histórico correlacionável (o cache do Rust só guarda o último
  envelope por tipo).
- Correlação exata via instrumentação no SDK (marcar cada fetch com a
  query que o disparou) — avaliada e descartada em favor da heurística
  desktop-side, mais barata e sem tocar em protocolo/SDK.

## Riscos e dependências

- **Falso positivo da heurística** — mitigado pela exigência de token
  overlap sempre + silêncio em empate; coberto por
  `correlateNetworkEntry.test.ts`'s casos de ambiguidade e de
  stopword/comprimento mínimo.
- **Tokens genéricos demais** (`api`, `v1`) — mitigado por uma stopword
  list curta e um comprimento mínimo de token (exceto tokens puramente
  numéricos, que são sinal forte mesmo curtos, ex. um id `42`).
- Depende da spec 0010 só para o texto do banner de Queries — a
  infraestrutura de banner/correlação em si funciona sem ela (Storage/
  Stores/Memory já eram editáveis antes).

## Métrica de sucesso

Sem telemetria — sinal qualitativo: um dev consegue, ao ver um request em
Network, ir direto pra query ou storage key correspondente sem precisar
procurar manualmente pela aba certa.

## Plano de teste

- **Automatizado:**
  - `apps/desktop/src/lib/__tests__/correlateNetworkEntry.test.ts` — match
    por tokens (query e storage), request órfão excluído, comprimento
    mínimo de token, stopwords, ambiguidade sem timing → sem link, timing
    desempatando, timing sozinho nunca produz match, host/querystring
    ignorados, ausência de meta não quebra.
  - `apps/desktop/src/state/__tests__/connection.test.ts` — `query/change`
    e `storage/change` atualizando `queriesMeta`/`storageMeta`
    corretamente, inclusive `changeType: "removed"`.
- **Manual/ao vivo:**
  1. Abrir cada uma das 4 telas editáveis, confirmar banner + borda,
     dispensar e confirmar que só o banner some.
  2. Provocar um request que corresponde a uma query/storage key
     existente por nome, abrir Network, clicar o chip "Related", confirmar
     navegação + destaque.
  3. Provocar o caso de ambiguidade proposital (duas queries com o mesmo
     conjunto de tokens) e confirmar que "Related" fica em silêncio.
