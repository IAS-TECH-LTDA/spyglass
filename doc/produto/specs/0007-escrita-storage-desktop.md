# 0007 — Escrita ao vivo em Storage KV a partir do desktop

- **Status:** em desenvolvimento
- **RICE:** R 5 · I 2 · C 70% · E 5 → **score 1.4**
- **Criada em:** 2026-08-12

## Contexto e problema

O protocolo (`packages/protocol`) é hoje 100% unidirecional: o SDK embarcado
no app RN emite envelopes pro desktop, nunca o contrário — existe até um
`hello/ack` declarado no tipo (`MessageType`), mas nunca implementado dos
dois lados. Pedido do usuário: poder editar um valor de JSON no desktop e
ter isso refletido em tempo real no app conectado.

Depende da spec 0006 (o novo `JsonGraph` é onde a edição acontece
visualmente), mas é uma entrega separada porque abre a primeira via de
comunicação Desktop → App do projeto — um canal novo, com timeout, ack, e
uma superfície de ataque diferente da spec 0006 (puramente visual).

## Personas / usuários afetados

- **Dev testando um estado específico de UI** — quer forçar um valor de
  storage (ex.: um flag, um token expirado, um contador) sem precisar
  navegar o app até lá manualmente.

## Histórias de usuário

Como dev inspecionando o Storage de um app conectado, quero editar o valor
de uma chave (AsyncStorage/MMKV/localStorage) direto no desktop, para
testar um cenário sem precisar reproduzi-lo manualmente no app.

Como dev, quero saber imediatamente se minha edição falhou (app
desconectado, build de produção, erro do próprio storage), para não achar
que uma mudança foi aplicada quando não foi.

## Critérios de aceite

- [ ] **CA1** — Dado um valor de chave em AsyncStorage, MMKV, ou
      localStorage/sessionStorage exibido no `JsonGraph` da tela Storage,
      Quando o dev dá duplo-clique num valor primitivo e confirma um novo
      valor, Então o app conectado recebe o comando e o valor real muda —
      confirmado pelo próprio `storage/change` que o app emite de volta.
- [ ] **CA2** — Dado que o app conectado está rodando em **produção**
      (`__DEV__`/`NODE_ENV=production`), Quando o desktop olha pra esse
      app, Então a UI mostra o valor como somente-leitura (sem nem tentar
      escrever) — o SDK nunca registra o handler de comandos em produção,
      não é só uma trava de UI.
- [ ] **CA3** — Dado um comando de escrita enviado, Quando o app não
      responde em 3s (desconectado, ou build antigo sem suporte), Então a
      UI mostra um estado de "falhou" com o motivo — nunca um no-op
      silencioso.
- [ ] **CA4** — Dado que o app desconecta explicitamente enquanto uma
      escrita está pendente, Quando o evento de desconexão chega, Então a
      escrita pendente falha imediatamente, sem esperar o timeout de 3s.
- [ ] **CA5** — Dado uma escrita pendente numa chave, Quando o app envia um
      `storage/change` pra essa mesma chave por conta própria (fora do
      comando) antes do ack chegar, Então a UI mostra um indicador de
      "mudou no app" (superseded) em vez de sobrescrever silenciosamente ou
      travar.
- [ ] **CA6** — Dado um edit "raw JSON" (textarea) usado para
      adicionar/remover uma chave ou dar append num array — mudança
      estrutural que a edição leaf-a-leaf não cobre, Quando o dev salva,
      Então o valor inteiro é escrito como um único comando.

## Checklist de impacto

- **Autenticação / autorização:** o WebSocket continua sem autenticação
  (fora de escopo desta spec, já sinalizado no backlog/spec 0003) — o novo
  canal de comando é gated por ambiente de dev (CA2), não por autenticação.
  Ver "Riscos" abaixo.
- **Isolamento de dados:** cada comando carrega o `appId` do app conectado
  no momento do envio, lido do estado atual (não capturado antes) — evita
  mandar um comando pro `appId` errado após uma reconexão.
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a — ferramenta de debug local, sem
  histórico de auditoria (mesmo padrão do resto do app).
- **Dados pessoais / privacidade:** o dev pode escrever qualquer dado que
  já conseguia ler no Storage do próprio app que está debugando — nenhuma
  superfície nova de dado, só direção nova (escrita em vez de só leitura).
- **Notificações / comunicação externa:** n/a.
- **Interface / experiência:** novo estado visual de pending/applied/
  failed/superseded no `JsonGraph`; toggle "Edit raw JSON" na Storage.
- **Migração de dados / schema:** dois `MessageType` novos
  (`storage/write`, `storage/write-result`) — aditivo, não quebra clients
  antigos (um SDK antigo simplesmente nunca responde, cobrindo o próprio
  CA3).
- **Compatibilidade / integração externa:** primeira mudança que torna o
  protocolo bidirecional (só para este par de tipos) — `CLAUDE.md` precisa
  de uma linha sobre isso.
- **Performance / escala:** valor de escrita capado client-side (~512 KB)
  antes de sair pro socket.

## Fora de escopo

- Escrita em Storage relacional (SQLite/Realm/WatermelonDB) — schema-aware,
  fica pra uma spec futura.
- Escrita em state managers (Redux/Zustand/Jotai/Recoil/MobX) — re-despachar
  numa store viva é um esforço por-adapter maior, deliberadamente adiado.
- Edição estrutural (add/remove chave) direto nos nós do diagrama — só via
  o textarea de JSON raw (CA6).
- Autenticação real do WebSocket — pré-requisito que resolveria o item de
  risco abaixo de raiz, já sinalizado fora de escopo desde a spec 0003.
- Implementar `hello/ack` de verdade — fora do par write/write-result.

## Riscos e dependências

- **Depende da spec 0006** — o `JsonGraph` precisa existir antes da UI de
  edição fazer sentido.
- **Sem autenticação no WebSocket**: qualquer dispositivo na mesma LAN que
  descubra o `appId` de um app em dev poderia, em teoria, mandar um comando
  de escrita — mitigado por ser dev-only (CA2) e pelo `appId` já estar
  vinculado à conexão TCP desde a correção de segurança da Parte A desta
  mesma leva de trabalho (não elimina o risco, mas reduz — um atacante
  ainda precisaria estar na LAN e conhecer o `appId`).
- **Sem garantia de entrega** nessa direção (app pode ter desconectado, ou
  ser uma versão do SDK sem suporte) — mitigado pelo timeout + estado de
  falha explícito (CA3).

## Métrica de sucesso

Um dev consegue mudar um valor de Storage KV do desktop e ver o app real
reagir em segundos, sem escrever nenhum código temporário no app pra forçar
aquele estado — validado ao vivo com AsyncStorage e MMKV reais.

## Plano de teste

- **Automatizado:**
  - `packages/protocol/src/__tests__/protocol.test.ts` — round-trip de
    `storage/write`/`storage/write-result`.
  - `packages/sdk/src/__tests__/storageWrite.test.ts` (padrão
    `WebSocketLike` fake de `transport.test.ts`): write pra engine
    registrada escreve e responde `ok`; engine desconhecida →
    `no-adapter`; `appId` alheio → ignorado; **`__DEV__ = false` ⇒
    `transport.onMessage` nunca é chamado** — teste de segurança central
    da feature (cobre CA2).
  - Reducer de `pendingWrites` como função pura: timeout → failed (CA3);
    `app-disconnected` falha tudo que está pendente (CA4); `storage/change`
    batendo → applied, não batendo → superseded (CA5); ack com
    `requestId` desconhecido é ignorado.
  - `cargo test`: `register_sender`/`send_to`/`unregister_sender`, erro em
    appId desconhecido e após unregister.
- **Manual/ao vivo:**
  1. Editar valor real em AsyncStorage e MMKV (os dois ramos do adapter —
     com e sem `addOnValueChangedListener`) e confirmar mudança real no
     app (CA1).
  2. Editar em localStorage/sessionStorage num app web (CA1).
  3. Editar JSON raw — add/remove chave, append em array (CA6).
  4. Matar o app em pleno write e confirmar estado "falhou" em ~3s (CA3).
  5. Derrubar a conexão explicitamente com um write pendente — falha
     imediata, sem esperar o timeout (CA4).
  6. Build de produção do app conectado — Storage aparece somente-leitura,
     sem sequer tentar (CA2).
  7. Escrever no mesmo valor por fora (ex.: um timer no próprio app)
     enquanto edita no desktop — indicador de "superseded", sem travar
     (CA5).
