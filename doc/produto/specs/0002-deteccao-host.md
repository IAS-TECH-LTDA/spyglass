# 0002 — Autodetecção de host de conexão (simulador, emulador, device físico)

- **Status:** em desenvolvimento
- **RICE:** R 9 · I 3 · C 80% · E 3 → **score 7.2**
- **Criada em:** 2026-08-03

## Contexto e problema

Hoje `DEFAULT_HOST = "localhost"` é fixo (`packages/protocol/src/constants.ts:10`)
e não existe nenhuma detecção automática de host. Isso funciona por acaso no
iOS Simulator e em ReactJS/web (mesma máquina), mas falha sempre em Android
Emulator (precisa `adb reverse`) e em device físico (precisa o IP da LAN
manual). Pior: a falha é **silenciosa e infinita** — `onerror` é um no-op
deliberado (`ws.ts:150-154`), não há log algum, e o retry roda pra sempre —
então quem conecta errado não recebe nenhum sinal do motivo.

Isso é o principal ponto de atrito comparado a ferramentas como o Reactotron,
que resolvem esse host automaticamente na maioria dos casos.

## Personas / usuários afetados

- **Dev integrando o SDK num app novo** — quer que `init({ appName })` "só
  funcione" nos quatro cenários (simulador iOS, emulador Android, device
  físico, web), sem precisar descobrir o IP da própria máquina manualmente.

## Histórias de usuário

Como dev integrando o `spyglass-react` no meu app, quero que o SDK descubra
sozinho o host do desktop a partir da URL do bundler (Metro/Expo), para eu
não precisar passar `host` manualmente na maioria dos casos — e quando não
conseguir conectar, quero uma mensagem clara no console dizendo contra qual
URL está tentando e o que fazer a respeito.

## Critérios de aceite

- [ ] **CA1** — Dado um app rodando no iOS Simulator, Quando chamo
      `init({ appName })` sem passar `host`, Então conecta usando `localhost`
      sem intervenção manual (comportamento já existente, não deve regredir).
- [ ] **CA2** — Dado um app rodando num device físico na mesma rede Wi-Fi do
      Mac, com Metro servindo por IP de LAN, Quando chamo `init({ appName })`
      sem `host`, Então o SDK extrai o IP de `NativeModules.SourceCode.scriptURL`
      e conecta nele automaticamente.
- [ ] **CA3** — Dado um app rodando no Android Emulator sem `adb reverse`
      configurado manualmente, Quando chamo `init({ appName })`, Então a
      tentativa em `localhost` falha e a tentativa seguinte usa `10.0.2.2`
      como candidato de fallback.
- [ ] **CA4** — Dado que uma conexão foi estabelecida com sucesso, Quando o
      desktop reinicia e o socket cai, Então a reconexão usa o mesmo host que
      funcionou (não volta a rotacionar candidatos).
- [ ] **CA5** — Dado um dev que passa `options.host` explicitamente (string
      ou função), Quando o SDK inicializa, Então esse valor tem prioridade
      total — nenhuma detecção automática roda.
- [ ] **CA6** — Dado que o SDK não consegue conectar em nenhum candidato,
      Quando isso persiste, Então uma mensagem é impressa no console (via
      `console.warn` original, não patchado) no máximo 1x a cada 30s,
      identificando a URL tentada e as ações possíveis — e essa mensagem
      **não aparece** na aba Console do próprio desktop app (não deve virar
      `log/entry`).
- [ ] **CA7** — Dado um build de produção (sem bridge de dev disponível),
      Quando o app roda, Então o comportamento é idêntico ao de hoje:
      silencioso, sem overhead perceptível, fallback para `localhost`.

## Checklist de impacto

- **Autenticação / autorização:** n/a.
- **Isolamento de dados:** n/a — sem multi-tenant.
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a.
- **Dados pessoais / privacidade:** nenhum dado pessoal novo. IPs de LAN e
  URLs de bundler são metadado técnico de rede local, não identificam
  pessoa.
- **Notificações / comunicação externa:** n/a.
- **Interface / experiência:** a tela vazia do desktop (`App.tsx`) passa a
  mostrar instruções de conexão reais (IPs da LAN, snippet por cenário) em
  vez do texto fixo `ws://localhost:8098` — ver spec de UI abaixo (mesma
  spec, item de escopo do desktop).
- **Migração de dados / schema:** nenhuma mudança de contrato de wire
  protocol — tudo isso é interno ao SDK (`transport/ws.ts`, novo
  `transport/devHost.ts`) e ao desktop (Rust `netinfo.rs`/`adb.rs`, que não
  cruzam o protocolo SDK↔desktop).
- **Compatibilidade / integração externa:** aditivo — `TransportOptions`
  ganha `hostReady`/`connectTimeoutMs`/`onDiagnostic`, todos opcionais.
  `InitOptions.host` continua aceitando string ou função, comportamento
  existente preservado byte a byte quando passado explicitamente.
- **Performance / escala:** desprezível — detecção roda uma vez (cacheada)
  e a rotação de candidatos só ativa quando a conexão já está falhando
  (mesmo custo de um ciclo de backoff a mais).

## Fora de escopo

- Detectar `10.0.3.2` (Genymotion) ou outras variantes de emulador Android
  além do padrão AVD.
- Suporte a IPv6 na lista de candidatos/nas instruções da UI.
- Autenticação/pareamento do WebSocket (fica como item de segurança
  separado no backlog).
- Criar um app de exemplo (`examples/rn-playground`) — a validação manual
  desta spec depende de um app real, dentro ou fora do repo, mas criar o
  playground em si não é objetivo desta spec.

## Riscos e dependências

- `NativeModules.SourceCode.scriptURL` não é documentado formalmente pelo
  React Native, mas é a técnica canônica usada por ferramentas do
  ecossistema (Reactotron inclusive) — mitigado por múltiplos fallbacks
  (`Platform.constants.ServerHost`, `expo-constants`, `location.hostname`)
  e por nunca lançar exceção.
- Tunnels do Expo (`--tunnel`, `*.exp.direct`) não são alcançáveis por
  `ws://` direto — o nome é mantido como candidato secundário, mas a
  conexão pode continuar falhando nesse modo específico; documentado como
  limitação conhecida no README do SDK.
- Depende da Parte B (desktop) para a UI mostrar os IPs reais — sem ela,
  CA2/CA3 continuam funcionando (a detecção é só do SDK), mas o dev não tem
  onde ver o IP sugerido na tela do desktop.

## Métrica de sucesso

Um dev que instala o SDK num app novo e chama só `init({ appName })`
consegue ver o app aparecer no desktop nos quatro cenários (simulador,
emulador, device físico, web) sem precisar descobrir/passar `host`
manualmente — validado nos cenários manuais do plano de teste abaixo.

## Plano de teste

- **Automatizado (vitest, `packages/sdk`):** ver `devHost.test.ts`,
  `diagnostics.test.ts` e adições a `transport.test.ts` — cobrem parsing da
  URL do bundler, cada cenário de candidatos (iOS/Android/tunnel/web),
  `pin()`, override explícito, timeout de conexão, throttle de diagnóstico,
  e a regressão específica de não vazar para `console.ts`.
- **Manual/ao vivo** (app externo ou `examples/rn-playground`, a criar):
  1. iOS Simulator — conecta sem `host`.
  2. Android Emulator com adb disponível — conecta via `localhost` +
     `adb reverse` automático (spec 0002 depende da 0003... ver spec de
     desktop para o watcher de adb).
  3. Android Emulator com `SPYGLASS_DISABLE_ADB=1` — conecta via
     `10.0.2.2` após uma tentativa falha em `localhost`.
  4. Device físico na mesma Wi-Fi — conecta sozinho pelo IP do Metro.
  5. Device físico com desktop fechado — uma linha de warn, depois no
     máximo 1/30s, nada na aba Console do desktop.
  6. Build release — sem overhead, sem mudança de comportamento.
