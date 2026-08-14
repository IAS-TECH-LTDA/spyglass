# 0014 — Limpar dados de storage a partir do desktop

- **Status:** em desenvolvimento
- **RICE:** R 5 · I 2 · C 70% · E 4 → **score 1.8**
- **Criada em:** 2026-08-14

## Contexto e problema

O canal `storage/write` (spec 0007) cobre `set`/`remove` numa chave — não
existe forma de zerar um engine inteiro (ou uma tabela) pela interface.
Hoje "resetar o storage" para testar um app do zero significa desinstalar
o app ou escrever código temporário nele. As engines relacionais
(SQLite/Realm/WatermelonDB) estão explicitamente fora do escopo de
`storage/write` desde a spec 0007 — não têm nenhum canal de escrita, muito
menos de limpeza.

## Personas / usuários afetados

- **Dev testando fluxo de first-run/onboarding** — quer voltar o app ao
  estado "zero dados" repetidamente sem reinstalar.
- **Dev depurando um bug de dado corrompido** — quer zerar uma tabela
  específica sem afetar o resto do banco.

## Histórias de usuário

Como dev inspecionando Storage, quero um botão "Clear" que apaga tudo de
um engine (AsyncStorage, MMKV, SQLite inteiro, etc.), para testar o
comportamento de primeiro uso do app sem reinstalar.

Como dev numa engine relacional, quero limpar só uma tabela específica sem
afetar as outras, para isolar um teste sem destruir dados que ainda
preciso.

Como dev prestes a apagar dados permanentemente, quero ser forçado a
confirmar digitando o nome do alvo, para não apertar um botão vermelho por
engano.

## Critérios de aceite

- [x] **CA1** — Dado um app conectado com `storage:clear` anunciada
      (dev-only, mesmo gate de `allowRemoteWrites` de `storage:write`),
      Quando o dev clica "Clear" numa engine, digita o nome exato da
      engine no modal de confirmação e confirma, Então o app recebe
      `storage/clear` com `scope: "all"` e responde `storage/clear-result`.
- [x] **CA2** — Dado uma engine relacional com uma tabela selecionada,
      Quando o dev clica "Clear table", digita o nome exato da tabela e
      confirma, Então o app recebe `storage/clear` com `scope: "table"` e
      o nome da tabela — só aquela tabela é apagada.
- [x] **CA3** — Dado o app conectado em build de produção (sem
      `allowRemoteWrites`), Quando o desktop olha esse app, Então nenhum
      botão de limpar aparece — mesmo "não oferecer o controle que só
      pode falhar" já usado por `storage:write`.
- [x] **CA4** — Dado um runner SQLite sem `exec()` (só leitura), Quando o
      dev tenta limpar, Então a resposta é `errorCode: "unsupported-op"`
      — distinto de uma falha real (`"engine-error"`), mostrado como "não
      suportado", não como "tentou e falhou".
- [x] **CA5** — Dado um comando de limpeza pendente, Quando o app
      desconecta antes de responder, Então a UI mostra falha imediata,
      sem esperar o timeout de 3s — mesmo comportamento de
      `sendStorageWrite`/`sendClearCache`.
- [x] **CA6** — Dado o texto exato digitado no modal, Quando ele não bate
      caractere por caractere com o nome do alvo, Então o botão de
      confirmar permanece desabilitado — não existe forma de confirmar
      "quase certo".

## Checklist de impacto

- **Autenticação / autorização:** o WebSocket continua sem autenticação
  (risco já sinalizado desde a spec 0003/0007) — a mitigação é a mesma:
  dev-only (CA3), e o `appId` já vinculado à conexão TCP.
- **Isolamento de dados:** cada comando carrega o `appId` lido do estado
  atual no momento do envio, mesmo padrão de `sendStorageWrite`.
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a — ferramenta de debug local.
- **Dados pessoais / privacidade:** o dev só pode apagar dados do próprio
  app que já está debugando — sem superfície nova de acesso, só uma ação
  destrutiva a mais sobre dados que ele já podia ler/editar.
- **Notificações / comunicação externa:** n/a.
- **Interface / experiência:** botão "Clear" na barra de engines
  (`.storage-chips`); botão "Clear table" no cabeçalho do painel de
  detalhe de tabela; modal `ConfirmClearDialog` (novo, reusável) exigindo
  digitar o nome exato do alvo — a única ação irreversível sem undo do
  app.
- **Migração de dados / schema:** dois `MessageType` novos aditivos
  (`storage/clear`, `storage/clear-result`) — clientes antigos
  simplesmente nunca respondem, coberto pelo mesmo timeout de 3s.
- **Compatibilidade / integração externa:** nenhuma edição em Rust
  necessária (payload opaco em `registry.rs`).
- **Performance / escala:** `DELETE FROM` por tabela é a operação mais
  cara aqui — sem limite adicional além do que o próprio SQLite impõe;
  fora de escopo otimizar bancos muito grandes.

## Fora de escopo

- Limpar uma coleção específica do WatermelonDB — só `scope: "all"` via
  `unsafeResetDatabase()`; um equivalente por-tabela exigiria muito mais
  trabalho por engine e ficou para uma spec futura.
- Desfazer uma limpeza (undo) — é destrutivo e permanente por design, daí
  a confirmação digitada em vez de um simples "tem certeza?".
- Autenticação real do WebSocket — mesmo risco/mitigação já aceito desde
  a spec 0003.

## Riscos e dependências

- **Sem garantia de entrega**, mesmo risco de `storage/write` — mitigado
  pelo timeout + estado de falha explícito (CA5).
- **Confiar no `exec`/`write` opcional de cada engine**: um app com um
  runner/instância que não implementa a operação de escrita necessária
  simplesmente não consegue limpar — comunicado como "unsupported-op"
  (CA4), nunca como uma falha silenciosa.

## Métrica de sucesso

Um dev consegue zerar o storage de um app (inteiro, ou uma tabela) do
desktop, com uma confirmação que realmente impede o clique acidental, sem
precisar reinstalar o app ou escrever código temporário.

## Plano de teste

- **Automatizado:**
  - `packages/protocol/src/__tests__/protocol.test.ts` — round-trip de
    `storage/clear`/`storage/clear-result`, `scope: "all"` e `"table"`.
  - `packages/sdk/src/__tests__/storageClear.test.ts` — padrão de
    `storageWrite.test.ts`: `__DEV__` false ⇒ handler nunca registrado
    (CA3); engine sem handler ⇒ `no-adapter`; `StorageClearUnsupportedError`
    ⇒ `errorCode: "unsupported-op"`, distinto de um `Error` comum ⇒
    `"engine-error"` (CA4); `appId` alheio ⇒ ignorado; `attachSqlite`
    sem `exec` no runner ⇒ `unsupported-op`; com `exec` ⇒ `DELETE FROM`
    por tabela e re-snapshot imediato, sem esperar o próximo poll.
  - `apps/desktop/src/state/__tests__/connection.test.ts` — reducer de
    `pendingStorageClears`: ack ok/false, requestId desconhecido
    ignorado, `markDisconnected` falha tudo que está pendente (CA5),
    `sendStorageClear` registra a entrada certa para `scope: "all"` e
    `"table"`.
- **Manual/ao vivo:**
  1. Limpar AsyncStorage inteiro e ver o app reagir (CA1).
  2. Limpar uma tabela SQLite específica com um runner que tem `exec` —
     só ela some, o resto do banco continua (CA2).
  3. Tentar limpar com um runner sem `exec` — ver "não suportado" em vez
     de travar (CA4).
  4. Build de produção do app conectado — nenhum botão de limpar aparece
     (CA3).
  5. Matar o app com uma limpeza pendente — falha imediata (CA5).
  6. No modal, digitar um nome quase certo (faltando uma letra) — botão
     de confirmar continua desabilitado (CA6).
