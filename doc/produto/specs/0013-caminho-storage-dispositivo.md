# 0013 — Caminho do arquivo de storage no dispositivo

- **Status:** em desenvolvimento
- **RICE:** R 5 · I 2 · C 80% · E 2 → **score 4.0**
- **Criada em:** 2026-08-14

## Contexto e problema

`StorageSnapshotPayload` (`packages/protocol`) sempre carregou só
`dbName?: string` — um rótulo cosmético que o dev passa à mão em
`attachX(..., { dbName })`, não um caminho de arquivo real. Nenhum adapter
do SDK lia o caminho do engine, mesmo quando a própria biblioteca expõe um
(`realm.path` sempre existiu; nenhum adapter o lia). No mobile, saber onde
o arquivo de banco realmente mora no dispositivo é o que separa "só
inspecionar" de "puxar o arquivo pra fora" — hoje isso é um ritual manual
de `adb shell run-as ... ls` ou vasculhar o container do Simulator.

Esta spec é o insumo direto da 0015 (exportar/importar o arquivo) — sem um
caminho confiável, não há o que puxar.

## Personas / usuários afetados

- **Dev inspecionando SQLite/Realm em produção de debug** — quer abrir o
  mesmo arquivo no DB Browser/Realm Studio sem caçar o caminho manualmente.

## Histórias de usuário

Como dev com `attachSqlite`/`attachRealm` conectado, quero ver o caminho
absoluto real do arquivo de banco na aba Storage do desktop, para poder
copiá-lo e usá-lo fora do Spyglass (adb, Realm Studio, etc.) sem precisar
descobri-lo manualmente.

Como dev usando um engine que não consegue ler seu próprio caminho
(AsyncStorage, MMKV, WatermelonDB), quero poder informar o caminho eu
mesmo, e que o desktop deixe claro que essa informação veio de mim, não do
engine.

## Critérios de aceite

- [x] **CA1** — Dado um app com `attachSqlite(runner)` conectado, Quando o
      runner responde a `PRAGMA database_list`, Então o desktop mostra o
      caminho absoluto do arquivo `main`, marcado como `source: "exact"` —
      lido direto do engine, sem configuração extra.
- [x] **CA2** — Dado um app com `attachRealm(realm)` conectado, Quando
      `realm.path` existe (sempre existe na lib real), Então o desktop
      mostra esse caminho, também `source: "exact"`.
- [x] **CA3** — Dado um runner SQLite que não suporta `PRAGMA` (lança
      erro), Quando o adapter tenta resolver o caminho, Então nenhum
      caminho é mostrado — `location` fica ausente, nunca um valor
      adivinhado.
- [x] **CA4** — Dado `attachMmkv`/`attachAsyncStorage`/`attachWatermelonDB`
      com a option `path` passada, Quando o snapshot é enviado, Então o
      desktop mostra esse caminho marcado como `source: "configured"` —
      visualmente distinto do `"exact"`.
- [x] **CA5** — Dado um app com uma versão antiga do SDK (sem este
      campo), Quando o desktop recebe o `storage/snapshot`, Então a UI
      simplesmente não mostra a linha de caminho — campo aditivo e
      opcional, sem quebrar clientes antigos.
- [x] **CA6** — Dado um caminho exibido, Quando o dev clica no botão de
      copiar ao lado dele, Então o caminho vai para a área de
      transferência (reuso do `CopyButton` já existente).

## Checklist de impacto

- **Autenticação / autorização:** n/a.
- **Isolamento de dados:** o caminho reportado é sempre o do próprio app
  conectado (mesma conexão WS que já reporta todo o resto de storage) —
  nenhuma superfície de dado nova, só um campo a mais no payload existente.
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a.
- **Dados pessoais / privacidade:** um caminho de arquivo no filesystem do
  dispositivo/simulador do próprio dev — mesma categoria de informação que
  o resto do payload de storage já expõe.
- **Notificações / comunicação externa:** n/a.
- **Interface / experiência:** nova linha "Path"/"Caminho" no topo do
  painel da engine selecionada em Storage, fonte monoespaçada, com botão
  de copiar; nota "(set by the app, not read from the engine)" quando
  `source: "configured"`.
- **Migração de dados / schema:** campo `location?: StorageLocation`
  aditivo em `StorageSnapshotPayload` — nenhuma edição em Rust
  (`registry.rs` trata `payload` como `serde_json::Value` opaco, só
  `HelloPayload` é espelhado à mão).
- **Compatibilidade / integração externa:** `MessageType`/payloads
  existentes não mudam de forma, só ganham um campo opcional — SDK antigo
  ↔ desktop novo e vice-versa continuam funcionando.
- **Performance / escala:** `PRAGMA database_list` roda uma única vez no
  attach do adapter SQLite, não a cada poll — custo desprezível.

## Fora de escopo

- Ler o caminho de MMKV/AsyncStorage automaticamente — nenhuma das duas
  APIs expõe isso de forma que o adapter (que recebe só a instância já
  construída) consiga alcançar.
- Caminho para WatermelonDB via introspecção do adapter interno — exigiria
  alcançar o `SQLiteAdapter` subjacente, que a interface pública da lib
  não expõe; fica com a option `path` manual (`configured`).
- Validar/normalizar o `path` informado manualmente — é responsabilidade
  do dev que o passou.

## Riscos e dependências

- **Nenhuma dependência de spec anterior** — extensão aditiva do payload
  `storage/snapshot` já existente (spec original de storage).
- **Spec 0015 depende desta** — export/import de arquivo só funciona com
  um `location.path` confiável.
- **Risco de caminho errado**: mitigado pela distinção `exact`/`configured`
  — um `path` mal digitado numa option manual fica visualmente marcado
  como não verificado, e a spec 0015 nunca tenta exportar sem `location`
  presente.

## Métrica de sucesso

Um dev com SQLite ou Realm conectado vê o caminho real do arquivo na aba
Storage e consegue copiá-lo e usá-lo fora do Spyglass, sem precisar rodar
`adb shell run-as ... ls` manualmente.

## Plano de teste

- **Automatizado:**
  - `packages/protocol/src/__tests__/protocol.test.ts` — round-trip de
    `storage/snapshot` carregando `location` (`exact` e `configured`), e
    sem `location` nenhum (compatibilidade com SDK antigo).
  - `packages/sdk/src/__tests__/storageLocation.test.ts` — `attachSqlite`
    resolve `location.source: "exact"` a partir de um runner fake
    respondendo a `PRAGMA database_list`; omite `location` quando o
    `PRAGMA` lança; `attachRealm` inclui `realm.path` como `"exact"`;
    `attachMmkv` inclui a option `path` como `"configured"`;
    `attachAsyncStorage` omite `location` sem a option `path`.
- **Manual/ao vivo:**
  1. Conectar um app com `attachSqlite` real (expo-sqlite) e conferir que
     o caminho mostrado bate com `adb shell run-as <pkg> ls -l <path>`
     (CA1).
  2. Conectar um app com `attachRealm` real e conferir contra
     `realm.path` (CA2).
  3. Passar `path` manualmente para `attachMmkv`/`attachAsyncStorage` e
     conferir a marca "configured" na UI (CA4).
  4. Copiar o caminho pelo botão e colar num terminal (CA6).
