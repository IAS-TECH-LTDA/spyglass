# 0001 — Detecção real de framework (Expo / RN bare / ReactJS-web)

- **Status:** em desenvolvimento (código + testes automatizados prontos; falta validação manual ao vivo)
- **RICE:** R 8 · I 2 · C 80% · E 1.5 → **score 8.5**
- **Criada em:** 2026-08-02

## Contexto e problema

O Spyglass se posiciona como inspetor para apps Expo, React Native
(bare) e ReactJS, mas hoje o SDK não distingue de fato essas três
situações. `detectPlatform()` (`packages/sdk/src/index.ts:115-129`) só
resolve `platform: "ios" | "android" | "web"` tentando `import("react-native")`
e lendo `Platform.OS`. Consequência:

- Um app **Expo** aparece como `"ios"`/`"android"`, indistinguível de
  um RN bare — quem está olhando o desktop não sabe se está debugando
  um app Expo ou bare RN, o que muda como reproduzir bugs (ex.:
  managed workflow vs. código nativo custom).
- `"web"` não é uma detecção positiva de browser — é o fallback de
  "o import do react-native falhou". Node, testes, e um app ReactJS
  real caem todos no mesmo valor por eliminação. Não há confirmação de
  que existe de fato um DOM (`document`/`window`).

Quem sente essa dor: qualquer usuário do desktop app (dev debugando um
app RN/Expo/Web) que precisa saber com qual tipo de runtime está
lidando para investigar um problema.

## Personas / usuários afetados

- **Dev instrumentando o app-alvo** (integra o SDK no Expo/RN/ReactJS) —
  não afetado diretamente, `init()` continua igual por padrão.
- **Dev usando o desktop app** para inspecionar/debugar — hoje não
  consegue confiar no campo de plataforma para saber se é Expo, RN bare
  ou web real.

## Histórias de usuário

Como dev usando o desktop app para inspecionar um app conectado, quero
que o app informe se é Expo, React Native bare ou ReactJS/web real,
para eu saber que tipo de runtime estou debugando sem precisar
perguntar ou adivinhar.

## Critérios de aceite

- [x] **CA1** — Dado um app RN que tem o pacote `expo` instalado
      (managed ou bare-com-expo-modules) rodando com o SDK, Quando o
      SDK chama `init()` e envia o `hello`, Então o `HelloPayload`
      inclui `framework: "expo"`. **Testado:** unitário
      (`detect.test.ts`, mock de `expo-constants` com
      `executionEnvironment`/`appOwnership` populados). Não testado ao
      vivo com um app Expo real.
- [x] **CA2** — Dado um app React Native bare (sem `expo` instalado),
      Quando o SDK envia o `hello`, Então `framework: "bare-rn"`.
      **Testado:** unitário (`detect.test.ts`). Não testado ao vivo.
- [x] **CA3** — Dado um ambiente com `document`/`window` reais
      (ReactJS rodando em browser), Quando o SDK envia o `hello`,
      Então `framework: "web"`. **Testado:** unitário (`detect.test.ts`,
      globals stubados). Não testado ao vivo num browser real.
- [x] **CA4** — Dado um ambiente que não é RN (import falha) e também
      não tem `document`/`window` (ex.: Node puro, ambiente de teste),
      Quando o SDK envia o `hello`, Então `framework: "unknown"` — e
      **não** `"web"` por eliminação. **Testado:** unitário
      (`detect.test.ts`).
- [x] **CA5** — Dado que o campo `platform` (`"ios"|"android"|"web"`)
      já existe e apps antigos (SDK não atualizado) continuam enviando
      só ele, Quando o desktop recebe um `hello` sem `framework`,
      Então nada quebra — o campo é tratado como opcional em todo o
      pipeline (Rust struct, TS types, UI). **Verificado:** estrutural
      — `framework?: Framework` (TS) e `framework: Option<String>` com
      `#[serde(default)]` (Rust) tornam o campo ausente equivalente a
      `None`/`undefined`; `pnpm typecheck` e `cargo check` passam.
      Sem teste dedicado de "hello sem framework" (não crítico dado que
      é comportamento padrão de campo opcional/serde default).
- [x] **CA6** — Dado um desenvolvedor que quer forçar o valor
      manualmente, Quando ele passa `options.framework` em `init()`,
      Então esse valor tem prioridade sobre a autodetecção (mesmo
      padrão já usado por `options.platform`). **Implementado**
      (`options.framework ?? (await detectFramework())` em
      `sendHello()`), mas **sem teste dedicado** — mesma lacuna que já
      existia para o override de `platform`, pré-existente a esta
      spec.

## Checklist de impacto

- **Autenticação / autorização:** n/a — não muda quem acessa o quê.
- **Isolamento de dados (multi-tenant):** n/a — não há multi-tenant
  neste produto (é um app desktop local).
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a — não é uma ação de escrita de
  usuário, é metadado de conexão.
- **Dados pessoais / privacidade:** nenhum dado pessoal novo. O valor
  de `framework` é técnico (nome de runtime), não identifica pessoa.
- **Notificações / comunicação externa:** n/a.
- **Interface / experiência:** por decisão de escopo (ver "Fora de
  escopo"), esta spec **não** adiciona ícone/badge novo no
  `App.tsx` — só o dado passa a existir e ser armazenado/repassado. A
  pill continua mostrando `platform` como hoje.
- **Migração de dados / schema:** é uma mudança de contrato de wire
  protocol (`packages/protocol/src/types.ts`) e do struct Rust
  espelhado (`apps/desktop/src-tauri/src/registry.rs`) — precisa dos
  dois lados atualizados juntos (ver CLAUDE.md: "a shape change there
  needs a matching Rust edit"). Como o campo é opcional/aditivo, não há
  migração de dados persistidos (o registry é em memória, não há
  storage a migrar).
- **Compatibilidade / integração externa:** aditivo e retrocompatível
  — `framework` é opcional em `HelloPayload`; SDKs antigos continuam
  funcionando sem ele (CA5). Bump de versão **minor** do protocolo, não
  major.
- **Performance / escala:** desprezível — uma checagem extra
  (`import("expo-constants")` + leitura de `typeof document`) só na
  inicialização (`sendHello`), não em caminho de alto volume.

## Fora de escopo

- Exibir ícone/label diferenciado por framework na UI do desktop
  (`App.tsx`) — fica como item futuro separado no backlog, a definir
  se/quando houver demanda de UX para isso.
- Detectar versão específica do Expo SDK (ex.: SDK 50 vs 51) — só a
  distinção Expo/bare-RN/web/unknown.
- Detectar frameworks além dos três citados (ex.: Next.js, Electron).

## Riscos e dependências

- **Risco de import de `expo-constants`:** assim como `react-native`,
  deve ser `import()` dinâmico (nunca estático), seguindo o padrão já
  usado pelos adapters do SDK, para não forçar essa dependência em
  quem não usa Expo.
- **Risco de falso-positivo Expo:** um app RN bare que só tem
  `expo-constants` instalado avulso (sem ser managed/bare-com-expo-modules)
  pode ser mal classificado como `"expo"`. Mitigar checando também
  `Constants.appOwnership` ou `Constants.executionEnvironment`
  (retorna valores como `"standalone"`/`"storeClient"`/`"bare"`) em vez
  de só a presença do pacote.
- **Dependência:** mudança de protocolo precisa manter
  `packages/protocol` e `apps/desktop/src-tauri/src/registry.rs`
  sincronizados manualmente (não há geração automática entre os dois).

## Métrica de sucesso

Depois de entregue: ao conectar um app Expo real, um app RN bare real
e um app ReactJS real (os três cenários do plano de teste manual), o
desktop recebe/armazena `framework` correto para cada um — validado
manualmente, já que não há telemetria de produto neste projeto.

## Plano de teste

- **Automatizado (vitest, `packages/sdk`):**
  - `detectFramework()` retorna `"expo"` quando o mock de
    `expo-constants` resolve com `executionEnvironment` de app
    Expo.
  - Retorna `"bare-rn"` quando `import("react-native")` resolve mas
    `import("expo-constants")` falha.
  - Retorna `"web"` quando `import("react-native")` falha e
    `typeof document !== "undefined"` (jsdom no ambiente de teste).
  - Retorna `"unknown"` quando nenhum dos dois é verdade.
  - `options.framework` explícito sempre vence a autodetecção.
  - Envelope `hello` inclui `framework` quando definido, e omite o
    campo (não `undefined` serializado) quando não aplicável.
- **Manual/ao vivo:**
  1. Rodar um app Expo (managed) de exemplo com o SDK, abrir o
     desktop, confirmar `framework: "expo"` no `hello` recebido
     (log/inspeção via Rust ou painel de debug).
  2. Rodar um app RN bare (sem Expo) com o SDK, confirmar
     `framework: "bare-rn"`.
  3. Rodar o SDK num contexto web real (ex.: app React puro no
     browser), confirmar `framework: "web"`.
  4. Confirmar que um app com SDK antigo (sem enviar `framework`)
     continua conectando normalmente, sem erro no desktop.
