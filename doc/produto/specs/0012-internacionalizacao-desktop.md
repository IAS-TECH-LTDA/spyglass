# 0012 — Internacionalização do desktop (inglês/português)

- **Status:** em desenvolvimento
- **RICE:** R 5 · I 1 · C 90% · E 5 → **score 0.9**
- **Criada em:** 2026-08-14

## Contexto e problema

A UI do desktop (`apps/desktop`) sempre foi ~95% inglês hardcoded, mas já
tinha acumulado 5 strings soltas em português
(`StorageView.tsx`, `StoresView.tsx`, `QueriesView.tsx`,
`MemoryPanel.tsx`, `LiveEditBanner.tsx`) — cada uma adicionada por conta
própria, sem nenhuma infraestrutura de tradução por trás. Não existia
`i18next`, `react-intl` nem equivalente no repositório; nenhum arquivo de
locale, nenhum seletor de idioma na interface.

Pedido do usuário: oferecer inglês e português, com inglês como padrão (a
SDK, o protocolo e os READMEs já são em inglês; o público de RN/Expo que o
projeto mira é global). Resolver isso antes das specs 0013–0015 evita que
os componentes novos daquelas specs nasçam com string hardcoded que
precisaria ser retrofitada depois.

## Personas / usuários afetados

- **Dev brasileiro/lusófono** inspecionando o próprio app — quer a UI do
  Spyglass no idioma que lê mais rápido, sem isso mudar o que é mostrado
  (dados do app conectado continuam exatamente como o app os envia).

## Histórias de usuário

Como dev que prefere português, quero trocar o idioma da interface do
Spyglass num único lugar e ver todas as abas, botões e mensagens
mudarem, para não precisar ler em inglês uma ferramenta que uso o dia
inteiro.

Como dev que já usa o Spyglass em inglês, quero que nada mude por padrão —
o idioma inicial continua inglês, e a escolha de idioma sobrevive a um
reinício do app.

## Critérios de aceite

- [x] **CA1** — Dado o desktop aberto pela primeira vez (sem preferência
      salva), Quando a UI renderiza, Então todo texto aparece em inglês —
      o comportamento observável não muda para quem já usa a ferramenta.
- [x] **CA2** — Dado o popover de engrenagem na topbar (renomeado de
      "Alert settings" para "Settings"), Quando o dev abre a seção
      "Language"/"Idioma" e escolhe Português, Então toda a UI — as 7 abas,
      empty states, banners, tooltips, mensagens de erro — muda para
      português imediatamente, sem recarregar a janela.
- [x] **CA3** — Dado um idioma escolhido, Quando o desktop é fechado e
      reaberto, Então o idioma escolhido persiste (`dm:locale` no
      localStorage, mesmo padrão de `dm:alert-settings`).
- [x] **CA4** — Dado qualquer uma das 5 strings antes hardcoded em
      português, Quando o idioma ativo é inglês, Então elas aparecem
      traduzidas em inglês — deixam de ser uma mistura de idiomas
      independente da escolha do usuário.
- [x] **CA5** — Dado um contador (requisições, telas, mudanças, etc.),
      Quando o valor é exatamente 1, Então a forma singular é usada em
      ambos os idiomas ("1 request"/"1 requisição"), não só em inglês.
- [x] **CA6** — Dado `pnpm typecheck`, Quando uma chave de tradução existe
      em `en.ts` mas falta em `pt.ts` (ou vice-versa), Então o build falha
      — `pt.ts` é tipado como `satisfies Translations` (derivado das
      chaves de `en.ts`), não há fallback silencioso em tempo de
      compilação.

## Checklist de impacto

- **Autenticação / autorização:** n/a.
- **Isolamento de dados:** n/a — só afeta o texto da chrome do desktop,
  nunca dados vindos do app conectado.
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a.
- **Dados pessoais / privacidade:** n/a.
- **Notificações / comunicação externa:** as notificações nativas de
  alerta (spec 0005) passam a respeitar o idioma ativo (`lib/alerts.ts`).
- **Interface / experiência:** ~210 chaves de tradução cobrindo as 22
  telas/componentes do desktop; nova seção "Language" no popover de
  configurações (primeira seção, já que é a única configuração global da
  aplicação).
- **Migração de dados / schema:** aditivo — `StorageSnapshotPayload` e
  demais tipos de protocolo não mudam nesta spec.
- **Compatibilidade / integração externa:** n/a — puramente
  `apps/desktop`, não toca `packages/protocol`/`packages/sdk`.
- **Performance / escala:** `t()`/`tp()` são lookups de objeto síncronos,
  sem custo de render mensurável; `useT()` adiciona uma subscrição
  Zustand por componente que já não estava lá.

## Fora de escopo

- Tradução das mensagens de diagnóstico do SDK (`packages/sdk`, "can't
  reach the desktop app at…") — são log de desenvolvimento, não UI, e
  traduzi-las quebraria buscas por essas strings em issues/documentação.
- Detecção automática do idioma do sistema operacional — o padrão é
  sempre inglês, escolha explícita do usuário muda para português.
- Terceiro idioma além de inglês/português.
- Tradução de nomes de bibliotecas/ferramentas (Redux, Zustand,
  AsyncStorage, npm, adb, …) — são substantivos próprios, idênticos nos
  dois idiomas.

## Riscos e dependências

- **Nenhuma dependência de protocolo/SDK** — mudança isolada a
  `apps/desktop`.
- **Risco de chave esquecida**: mitigado por `pt.ts` ser tipado como
  `satisfies Translations` (CA6) — uma chave nova em `en.ts` sem
  contraparte em `pt.ts` quebra `pnpm typecheck`, não passa despercebida.
- **Risco de re-render**: `t()`/`tp()` standalone (usados fora de
  componentes React, ex. `state/connection.ts`, `lib/alerts.ts`) lêem o
  locale atual via `useLocaleStore.getState()`, sem disparar re-render por
  si — quem precisa reagir à troca de idioma usa `useT()`, que assina o
  store.

## Métrica de sucesso

Um dev troca o idioma no popover de configurações e vê a interface inteira
mudar sem inconsistência — nenhuma tela fica "meio traduzida" — e essa
escolha sobrevive a um reinício do app.

## Plano de teste

- **Automatizado:**
  - `apps/desktop/src/i18n/__tests__/i18n.test.ts` — paridade de chaves
    entre `en`/`pt`, interpolação de `{var}`, seleção de plural (`tp()`)
    em 0/1/2, troca de locale sem depender de re-render do React.
  - `pnpm typecheck` (`apps/desktop`) — pega qualquer chave faltando via
    `satisfies Translations`.
  - `pnpm test` (`apps/desktop`) — os 115 testes existentes (reducer,
    alerts, buildJsonGraph, etc.) continuam passando com o locale padrão
    `en`, provando que a extração não mudou nenhum texto em inglês.
- **Manual/ao vivo:**
  1. Abrir o desktop pela primeira vez — confirmar que está em inglês
     (CA1).
  2. Trocar para português no popover de engrenagem — confirmar que as 7
     abas, `ConnectView`, `MemoryPanel`, `StorageView` e as demais telas
     mudam de idioma sem recarregar (CA2).
  3. Fechar e reabrir o app — confirmar que o idioma escolhido persiste
     (CA3).
  4. Com um app conectado usando Storage/Stores/Queries com escrita ao
     vivo, conferir os banners `LiveEditBanner` nos dois idiomas — não
     devem mais aparecer hardcoded em português quando o idioma ativo é
     inglês (CA4).
  5. Gerar 0, 1 e 2+ de um contador plural (ex. requests no Network) nos
     dois idiomas e conferir a forma singular/plural correta (CA5).
