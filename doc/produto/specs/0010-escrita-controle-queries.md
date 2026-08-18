# 0010 — Escrita e controle ao vivo de Queries (React Query)

- **Status:** em desenvolvimento
- **RICE:** R 5 · I 2 · C 75% · E 4 → **score 1.9**
- **Criada em:** 2026-08-13

## Contexto e problema

A aba **Queries** do Spyglass desktop era só leitura: status, fetchStatus,
data e error de cada query do React Query, sem nenhum jeito de agir sobre
isso a partir da ferramenta. Isso destoava do resto do produto — **Storage**
(spec 0007) e **State/Zustand** (spec 0007-state) já tinham escrita ao vivo,
e **Memory** (spec 0008) já tinha uma ação de "clear caches".

O pedido do usuário: "queries poderiam ser editadas... querys tem que ter
botão de atualizar dados ou invalidar assim como as propriedades do react
query. seria interessante um controle do lado da ferramenta aqui e não só
pelo código da aplicação." — ou seja, editar o dado em cache **e** acionar
as próprias operações de ciclo de vida do React Query (refetch, invalidate,
reset, remove) a partir do desktop.

**O ponto de risco identificado e resolvido antes de codar**:
`QueryInfo.queryKey` que chega no desktop já passou por `safeSerialize`
(`packages/sdk/src/query/reactQuery.ts`), que pode truncar/normalizar
valores (`Date` → string ISO, objetos profundos → `TruncatedValue`). Se o
desktop reconstruísse esse `queryKey` e mandasse de volta pra endereçar
`setQueryData`/`refetchQueries`, o hash recalculado poderia não bater com o
da query real — falha silenciosa. A solução: todo o protocolo deste spec é
**`queryHash`-first** — o desktop nunca manda `queryKey` de volta, só o
hash (string opaca, nunca passa por serialização com risco); o SDK acha a
query com `cache.getAll().find(q => q.queryHash === hash)` e usa
`found.queryKey`, a referência viva que o próprio `QueryCache` já indexa.

## Histórias de usuário

Como dev depurando um bug de cache, quero editar o `data` de uma query
diretamente pelo desktop, para testar como meus componentes reagem a um
estado específico sem precisar mockar a API.

Como dev, quero um botão "Refetch"/"Invalidate"/"Reset"/"Remove" por query,
que chame exatamente o método correspondente do `QueryClient`, para
controlar o ciclo de vida do cache sem precisar escrever esse código
temporariamente no app.

## Critérios de aceite

- [ ] **CA1** — Dado um app conectado com `attachReactQuery(queryClient)` e
      `allowRemoteWrites` habilitado, Quando o dev abre a aba Queries e
      seleciona uma query, Então o campo `Data` é editável pelo `JsonGraph`
      (mesmo padrão de Storage/Stores) e aparecem 4 botões: Refetch,
      Invalidate, Reset, Remove.
- [ ] **CA2** — Dado um edit no campo `Data`, Quando o desktop envia
      `query/write`, Então o SDK acha a query pelo `queryHash` e escreve na
      própria instância `Query` resolvida (`found.setData(data, { manual: true
      })`, com fallback para `queryClient.setQueryData(found.queryKey, data)`
      quando a instância não expõe `setData`) — nunca um `queryKey`
      reconstruído do payload —, relê a query pelo hash e só responde `ok`
      se `dataUpdatedAt`/`data` de fato mudaram (ver "Riscos e dependências"
      abaixo); o desktop mostra pending→applied/failed/superseded, nunca
      aplica o valor otimisticamente.
- [ ] **CA3** — Dado um clique em qualquer um dos 4 botões, Quando o
      comando chega no SDK, Então ele chama o método correspondente do
      `QueryClient` (`refetchQueries`/`invalidateQueries`/`resetQueries`/
      `removeQueries`) com `{ queryKey: found.queryKey, exact: true }`, e
      aguarda (`await`) a chamada real terminar antes de responder `ok`.
- [ ] **CA4** — Dado que a query alvo não existe mais no cache do
      `QueryClient` (hash desconhecido), Quando qualquer `query/write` ou
      `query/command` chega, Então o SDK responde `errorCode: "no-query"`,
      distinto de `"no-adapter"` (nenhum `attachReactQuery` rodou) e de
      `"engine-error"` (a chamada em si lançou).
- [ ] **CA5** — Dado `allowRemoteWrites` desligado (produção, por padrão),
      Quando `query/write`/`query/command` chegam, Então nenhum handler foi
      registrado e nada é respondido — mesmo hard gate das outras escritas,
      não é forçável via `allowRemoteWrites: true`.
- [ ] **CA6** — Dado que uma query tem `observersCount > 0`, Quando o dev
      clica "Remove", Então a query pode reaparecer quase instantaneamente
      (o próprio observer do React Query refaz o fetch) — comportamento
      esperado do React Query, sinalizado com um `title` de aviso no botão,
      não uma falha do canal.
- [ ] **CA7** — Dado um `query/write` cujo cache não muda apesar da escrita
      não ter lançado, Quando o SDK confirma via releitura que
      `dataUpdatedAt`/`data` não avançaram, Então responde
      `errorCode: "not-applied"` em vez de `ok: true` — e dado um `query/write`
      sem a chave `data` (indistinguível de `undefined`, que não sobrevive ao
      wire JSON), Então responde `errorCode: "invalid-data"` sem chamar o
      handler. O desktop mostra o texto correspondente na aba Queries em vez
      de só um ponto de status.
- [ ] **CA8** — Dado um `query/write` já confirmado `applied`, Quando o app
      reporta via `query/change` um `data` diferente do que foi escrito
      (tipicamente um refetch próprio do React Query — `refetchOnWindowFocus`,
      `refetchInterval`, remount com `staleTime: 0`), Então o desktop marca a
      escrita como `"superseded"` e explica isso na aba Queries, em vez de
      deixar o dev acreditando que a escrita "pegou" quando ela foi
      sobrescrita segundos depois.

## Checklist de impacto

- **Autenticação / autorização:** mesmo hard-gate dev-only (`allowRemoteWrites`)
  de spec 0007/0007-state/0008 — uma única capability `query:write` cobre
  write e os 4 comandos.
- **Isolamento de dados:** n/a — cada comando é endereçado por `queryHash`,
  escopado ao `QueryClient` já registrado via `attachReactQuery`.
- **Migração de dados / schema:** aditivo — 4 `MessageType`s novos
  (`query/write`, `query/write-result`, `query/command`,
  `query/command-result`); um SDK antigo simplesmente nunca responde a eles.
- **Compatibilidade / integração externa:** `QueryClientLike` (interface
  estrutural, sem depender de `@tanstack/react-query`) ganha 5 métodos
  novos (`setQueryData`, `invalidateQueries`, `refetchQueries`,
  `resetQueries`, `removeQueries`) — qualquer objeto que já implementa a
  API real do `QueryClient` do TanStack Query v4/v5 satisfaz isso sem
  mudança nenhuma da parte do usuário do SDK.
- **Performance / escala:** nenhuma — comandos são disparados por ação
  explícita do usuário, um de cada vez (a UI desabilita os 4 botões
  enquanto qualquer comando pra aquele `queryHash` está pending).

## Fora de escopo

- Editar `queryKey` ou opções da query (staleTime, retry, etc.) — só `data`.
- `cancelQueries` — não pedido; o par natural de um `fetchStatus: "fetching"`
  travado, mas não fazia parte do pedido original.
- Múltiplos `QueryClient`s por app — hoje há só um slot de handler
  módulo-level, como há só um `QueryClient` típico numa árvore React.

## Riscos e dependências

- **`queryKey` lossy via `safeSerialize`** — endereçado desde o design (ver
  "Contexto e problema"); coberto por teste dedicado
  (`packages/sdk/src/__tests__/queryWrite.test.ts`, "setQueryData is called
  with the ORIGINAL... queryKey").
- **`queryClient.setQueryData` re-deriva o hash, não o herda da query
  encontrada** — descoberto depois do lançamento inicial: `setQueryData`
  chama `defaultQueryOptions({ queryKey })` internamente e re-hasheia com as
  opções *default do client*, não com as opções com que a query alvo foi de
  fato construída. Uma query com `queryKeyHashFn` próprio hasheia diferente
  e `queryCache.build()` cria silenciosamente uma Query nova (sem
  observers) em vez de escrever na existente — nada lança, e o canal
  respondia `ok: true` mesmo sem o app mudar. Corrigido escrevendo direto na
  instância `Query` já resolvida por hash (`found.setData`, com
  `setQueryData` só como fallback) e verificando por releitura que o cache
  mudou antes de responder `ok` (`errorCode: "not-applied"` caso contrário)
  — ver CA2/CA7 e os testes de regressão em `queryWrite.test.ts`
  ("root-cause repro").
- **Escrita sobrescrita por um refetch do próprio app** — não é um bug deste
  canal, mas era invisível: o app pode refazer o fetch por conta própria
  (`refetchOnWindowFocus` ao focar de volta o app depois do Spyglass,
  `refetchInterval`, remount) segundos depois de um `ok: true`. O desktop
  agora reconcilia `query/change` contra escritas já `"applied"` e marca
  `"superseded"` quando o dado diverge — ver CA8.
- **`attachReactQuery` chamado duas vezes (hot-reload)** — o detach da
  primeira chamada não pode arrancar os handlers da segunda; coberto por
  teste dedicado ("detach() unregisters both handlers...").
- Depende de uma versão nova do SDK publicada (`pnpm release`) antes de
  qualquer app real poder usar isso — ver `CLAUDE.md`, seção "Publishing".

## Métrica de sucesso

Sem telemetria — sinal qualitativo: um dev consegue, ao vivo, forçar um
refetch ou editar o cache de uma query sem sair do Spyglass nem tocar no
código do app.

## Plano de teste

- **Automatizado:**
  - `packages/sdk/src/__tests__/queryWrite.test.ts` — bateria completa de
    gate (routes/no-adapter/no-query/engine-error/appId errado/gates de
    produção) para `query/write` e `query/command` (todas as 4 variantes),
    mais o teste de identidade referencial do `queryKey`, o de detach, o
    caminho via `Query.setData`, o repro da causa-raiz (hash re-derivado
    escrevendo em outra query → `not-applied`), a query sumindo durante a
    escrita, `invalid-data` para um frame sem `data`, e a guarda contra
    falso-negativo por structural sharing.
  - `apps/desktop/src/state/__tests__/connection.test.ts` — reconciliação de
    `pendingQueryWrites`/`pendingQueryCommands` (ack ok/erro, requestId
    desconhecido, `markDisconnected`, guard de valor truncado/`undefined`,
    `errorCode` propagado) e a reconciliação de `query/change` contra
    `pendingQueryWrites` (pending→applied/superseded, `applied`→`superseded`
    pelo overwrite, hash diferente intocado, escrita já `failed` não
    ressuscita).
  - `packages/protocol/src/__tests__/protocol.test.ts` — round-trip dos 4
    `MessageType`s novos, mais os `errorCode`s `not-applied`/`invalid-data` e
    o comportamento de `data: undefined` no wire.
- **Manual/ao vivo:**
  1. Conectar um app RN de teste com `attachReactQuery(queryClient)`, uma
     query cujo `queryKey` inclua um `Date` (para exercitar o ponto de
     risco do `safeSerialize` na prática).
  2. Editar o campo Data, confirmar no app real que `useQuery().data`
     mudou.
  3. Clicar os 4 botões, confirmando o efeito real de cada um (rede nova,
     `isInvalidated`, volta a `pending`/`data: undefined`, some do cache).
  4. Testar "Remove" com um `useQuery` ativo montado e confirmar que a
     query reaparece via refetch automático do observer.
