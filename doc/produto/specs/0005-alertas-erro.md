# 0005 — Alertas (som, badge in-app, notificação nativa do macOS) para erros

- **Status:** em desenvolvimento (código + testes automatizados prontos; falta validação manual ao vivo numa máquina real)
- **RICE:** R 8 · I 3 · C 80% · E 4 → **score 4.8**
- **Criada em:** 2026-08-03

## Contexto e problema

Hoje, se um erro aparece no Console ou uma requisição falha no Network,
nada chama a atenção do dev — ele só descobre se estiver olhando pra aba
certa no momento certo. Com múltiplos apps conectados ou o Spyglass num
segundo monitor, é fácil perder um erro relevante.

Pedido do usuário: "preciso de notificações dentro do app e fora com push
notification, preciso de alertas sonoros no app, para quando tiver um erro
nos logs e network".

## Personas / usuários afetados

- **Dev com o Spyglass aberto enquanto trabalha em outra janela** — quer
  ser avisado por som e/ou notificação do SO sem precisar manter o olho na
  aba Console/Network o tempo todo.
- **Dev debugando dois apps ao mesmo tempo** — quer saber qual dos dois
  apps está com problema sem alternar entre pills, e poder silenciar um
  deles especificamente se for ruído esperado.

## Histórias de usuário

Como dev com o Spyglass aberto, quero ouvir um som e ver um badge quando
um `console.error` ou uma requisição de rede falhar, para não precisar
ficar checando a aba manualmente.

Como dev com o Spyglass em segundo plano, quero receber uma notificação
do macOS quando um erro acontecer, para saber que preciso voltar pro app.

Como dev com múltiplos apps conectados, quero poder silenciar alertas de
um app específico (ou de um nível de log específico), para não ser
interrompido por ruído que já sei que existe.

## Critérios de aceite

- [x] **CA1** — Dado o Spyglass aberto e focado, Quando um app conectado
      emite `console.error(...)`, Então um som toca e o pill do app +
      a aba Console ganham um badge de contagem. **Implementado**
      (`alertRunner.ts` + `AppData.alerts` em `connection.ts`); a
      classificação/gating é testada em `alerts.test.ts`. **Não testado ao
      vivo** (som/badge visual precisam de app real + máquina real).
- [x] **CA2** — Dado o Spyglass aberto e focado, Quando uma requisição de
      rede falha (status ≥400 ou falha de transporte, sem resposta), Então
      o mesmo comportamento do CA1 acontece para o pill do app + aba
      Network. **Implementado e testado** (`isFailedResponse`/
      `classifyEnvelope` em `alerts.test.ts`, incluindo o caso "sem status,
      sem error, sem ok" que quebraria se reusasse `statusClass` direto).
      Badge visual não testado ao vivo.
- [x] **CA3** — Dado o Spyglass em segundo plano (sem foco), Quando um
      erro dispara (CA1/CA2), Então uma notificação nativa aparece na
      Central de Notificações do macOS. **Implementado**
      (`alertNotification.ts` + plugin Tauri registrado, `cargo check`
      confirma resolução do crate). **Não testado ao vivo** — é o item de
      maior risco do plano (WKWebView/autoplay/entrega em segundo plano só
      são verificáveis numa máquina real).
- [x] **CA4** — Dado que o dev nunca respondeu ao prompt de permissão de
      notificação, Quando o primeiro erro dispara, Então o macOS pede
      permissão uma única vez; se negada, nenhuma notificação futura tenta
      pedir de novo automaticamente (só via botão explícito nas
      configurações). **Implementado** (`ensurePermission()` memoiza via
      `notificationPermission` persistido + promise em voo pra evitar
      múltiplos prompts concorrentes). Não testado ao vivo.
- [x] **CA5** — Dado o painel de configurações de alerta, Quando o dev
      desliga o mute geral, um nível de log específico, o toggle de
      network, ou mutar um app específico, Então o efeito é imediato (sem
      precisar recarregar) e persiste depois de reiniciar o desktop.
      **Implementado** (`alertSettings.ts` com `zustand/persist`,
      `AlertSettingsPanel.tsx`). Persistência entre restarts não testada ao
      vivo.
- [x] **CA6** — Dado um app que reconecta (novo `appId`, mesmo
      `appName`+`platform`), Quando esse app estava mutado antes da
      reconexão, Então continua mutado depois. **Testado** (`appAlertKey`
      em `alerts.test.ts` — mesma chave para `appId`s diferentes com o
      mesmo `(name, platform)`, o invariante central desse critério).
      Reconexão real de um app não testada ao vivo.
- [x] **CA7** — Dado um erro já em cache no servidor (última mensagem
      daquele tipo), Quando o frontend recarrega ou uma reconexão dispara o
      replay do cache, Então **nenhum** som/notificação nova dispara — só
      dados ao vivo alertam. **Garantido arquiteturalmente**:
      `handleEnvelopeForAlerts` só é chamado a partir do `onMessage` ao
      vivo em `App.tsx`, nunca do caminho `hydrateFromCache`/
      `getCachedMessages` — comentário explícito no código pra não ser
      "corrigido" por engano depois. Não coberto por teste automatizado
      (exigiria um teste de integração do `App.tsx`, fora do escopo
      aprovado desta spec); não testado ao vivo.
- [x] **CA8** — Dado uma rajada de muitos erros em sequência (ex.: loop
      batendo num endpoint fora do ar), Quando isso acontece, Então o badge
      conta todos, mas som e notificação são limitados (no máximo 1 som a
      cada poucos segundos, 1 notificação a cada dezena de segundos) — sem
      martelar o dev. **Testado** (`RateLimiter` em `alerts.test.ts`:
      primeira chamada libera, chamadas dentro da janela são bloqueadas e
      contadas, janela seguinte libera reportando `suppressed`). Rate
      limiters são globais (não por app) por decisão de design.
- [x] **CA9** — Dado o dev na aba Console/Network do app selecionado,
      Quando um novo erro chega, Então o badge **não** aparece pra esse
      alerta (já está visível), mas o som ainda toca (assimetria
      deliberada — o dev pode estar olhando outro monitor).
      **Implementado** (`recordAlert` em `connection.ts` no-opa quando
      `selectedAppId`+`activeTab` já correspondem ao alerta; `alertRunner.ts`
      dispara som/notificação incondicionalmente a essa checagem — só
      passa pelo `shouldAlert` de settings). Não coberto por teste
      automatizado (lógica vive em `connection.ts`, fora do escopo de
      teste aprovado para esta spec — só `alerts.ts` foi coberto); não
      testado ao vivo.

## Checklist de impacto

- **Autenticação / autorização:** n/a.
- **Isolamento de dados:** n/a.
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a.
- **Dados pessoais / privacidade:** a notificação nativa mostra um trecho da
  mensagem de erro/URL na Central de Notificações do macOS — se o dev
  estiver compartilhando tela nesse momento, isso fica visível; comportamento
  esperado de qualquer notificação de qualquer app, não é dado novo sendo
  coletado ou enviado a lugar nenhum (tudo local).
- **Notificações / comunicação externa:** é o próprio escopo da spec — mas
  **local apenas** (Central de Notificações do macOS), sem push real, sem
  servidor externo, sem conta de terceiro.
- **Interface / experiência:** badge novo nos pills e nas abas Console/Network;
  painel de configurações novo (engrenagem na topbar). Sem toast/popup
  intrusivo — decisão explícita, ver "Fora de escopo".
- **Migração de dados / schema:** nenhuma mudança de contrato de wire
  protocol — tudo reage a envelopes que o desktop já recebe hoje
  (`log/entry`, `network/response`).
- **Compatibilidade / integração externa:** aditivo. `apps/desktop` ganha
  duas dependências novas (`@tauri-apps/plugin-notification` +
  `tauri-plugin-notification`), sem afetar `packages/sdk`/`packages/protocol`.
- **Performance / escala:** rate limiting explícito (CA8) evita que uma
  rajada de erros vire uma rajada de sons/notificações. Reprodução de som via
  Web Audio é leve; notificação nativa é uma chamada assíncrona ao plugin.

## Fora de escopo

- Push notification de verdade (APNs/FCM) pro celular do dev — decisão
  explícita do usuário: só notificação nativa do macOS, sem servidor
  externo.
- Toast/pop-up transitório dentro do app — badge persistente escolhido no
  lugar (mais correto pra rajadas de erro e pra "eu estava olhando pra
  outro lugar").
- Suporte a Windows/Linux para a notificação nativa — o app hoje só roda em
  macOS na prática (`tauri.conf.json` sem bundle ativo); o plugin Tauri é
  cross-platform mas só será validado no macOS nesta spec.
- Som customizável pelo usuário (upload de arquivo próprio) — v1 usa um
  blip sintetizado fixo.
- Alertar sobre `console.warn` por padrão — o toggle existe na UI mas
  começa desligado; é o dev quem liga se quiser.

## Riscos e dependências

- **Autoplay de áudio no WKWebView do macOS**: não é garantível por leitura
  de código — precisa de verificação manual numa máquina real (ver plano de
  teste). Mitigação: `AudioContext` armado no primeiro gesto do usuário
  (clique/tecla), não na carga da página.
- **`tauri.conf.json` tem `bundle.active: false`** e não há ícone `.icns` —
  a entrega de notificação nativa pode se comportar diferente entre
  `pnpm dev:desktop` (binário não empacotado) e um build empacotado de
  verdade. Documentar a diferença se for observada, não tentar resolver
  bundling nesta spec.
- **Replay do cache do servidor** (`registry.rs` cacheia o último envelope
  por tipo) — mitigado architeturalmente: o disparo de alerta só escuta
  mensagens ao vivo (`onMessage`), nunca o caminho de
  `hydrateFromCache`/`getCachedMessages`. CA7 cobre isso.

## Métrica de sucesso

Um dev com o Spyglass aberto (focado ou não) percebe um erro de log ou
falha de rede sem precisar estar olhando pra aba certa — validado
manualmente repetindo os cenários do plano de teste abaixo, incluindo o
caso de rajada e o caso de app mutado sobrevivendo a uma reconexão.

## Plano de teste

- **Automatizado (vitest, `apps/desktop` — primeiro teste real do pacote):**
  `isFailedResponse`, `classifyEnvelope`, `shouldAlert`, `appAlertKey`,
  `RateLimiter` — ver `apps/desktop/src/lib/__tests__/alerts.test.ts`.
- **Manual/ao vivo** (precisa de máquina real, nenhum destes é verificável
  por código):
  1. Primeira execução — 1 prompt de permissão, sem repetir depois.
  2. Negar permissão — badge/som continuam, notificação não, sem erro.
  3. App em segundo plano — notificação aparece na Central de Notificações.
  4. Som — clicar na janela primeiro, disparar erro, confirmar áudio.
  5. Rajada — badge conta tudo, som/notificação respeitam o rate limit.
  6. Configurações têm efeito imediato e sobrevivem a restart.
  7. App mutado sobrevive a uma reconexão real (novo `appId`).
  8. Reload do frontend com erro em cache — zero som/notificação da replay.
  9. Badge limpa ao entrar na aba certa; som ainda toca se já estiver nela.
