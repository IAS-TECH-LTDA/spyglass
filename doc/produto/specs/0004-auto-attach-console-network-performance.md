# 0004 — Auto-attach de Console, Network e Performance em dev

- **Status:** em desenvolvimento (código + testes automatizados prontos; falta validação manual ao vivo)
- **RICE:** R 9 · I 2 · C 90% · E 1.5 → **score 10.8**
- **Criada em:** 2026-08-03

## Contexto e problema

Hoje `init()` só abre a conexão WebSocket — cada capacidade (navegação,
estado, storage, console, network, performance) é um adapter que o dev
precisa anexar manualmente (`attachConsole()`, `attachNetwork()`, etc.), como
documentado em `packages/sdk/README.md`. Isso é necessário pra navegação e
estado/storage, que dependem de uma referência que só existe no código do
app (o `navigationRef`, a instância da store, o objeto `AsyncStorage`) — o
SDK não tem como adivinhar isso.

Mas **Console, Network e Performance não recebem nenhuma referência
específica do app** (`attachConsole()`, `attachNetwork()` e
`attachPerformance()` funcionam sem argumento algum, patchando globais).
Exigir uma chamada manual pra essas três é fricção pura: na prática, quem
integra o SDK conecta, vê o app aparecer no desktop, e só descobre — como
aconteceu nesta sessão — que "nada aparece" porque esqueceu (ou nem sabia)
que precisava chamar mais três funções.

## Personas / usuários afetados

- **Dev integrando o SDK pela primeira vez** — espera que console/network/
  performance "só funcionem" depois do `init()`, do mesmo jeito que a
  conexão em si já funciona sozinha (spec 0002).

## Histórias de usuário

Como dev integrando o `spyglass-react`, quero que logs de console, chamadas
de rede e métricas de performance apareçam no desktop assim que eu chamo
`init()` em desenvolvimento, sem precisar lembrar de anexar cada adapter
manualmente — mas sem isso rodar escondido em produção nem duplicar dados
se eu também chamar o adapter manualmente por algum motivo.

## Critérios de aceite

- [x] **CA1** — Dado um ambiente de desenvolvimento (mesma detecção já usada
      pela opção `diagnostics`: `__DEV__` ou `NODE_ENV !== "production"`) e
      nenhuma chamada manual a `attachConsole`/`attachNetwork`/
      `attachPerformance`, Quando `init({ appName })` roda, Então as três
      capacidades aparecem em `hello.capabilities` e um `console.log`,
      uma chamada de rede e um frame lento geram `log/entry`,
      `network/request` e `perf/stall` respectivamente, sem nenhuma chamada
      manual. **Testado:** unitário (`autoAttach.test.ts`, via `WebSocket`
      global stubado + inspeção do envelope `hello`). Não testado ao vivo
      num app real.
- [x] **CA2** — Dado um ambiente de produção (`__DEV__: false` ou
      `NODE_ENV: "production"`), Quando `init({ appName })` roda sem
      override, Então nenhuma das três é anexada automaticamente —
      comportamento idêntico ao de hoje (opt-in manual). **Testado:**
      unitário. Não testado ao vivo.
- [x] **CA3** — Dado um dev que quer forçar ligado em produção ou desligado
      em dev, Quando passa a opção de override em `init()`, Então o valor
      explícito vence a detecção de ambiente, por capacidade
      individualmente (ex.: ligar console mas não network). **Testado:**
      unitário (override por capacidade em dev e em produção, e override
      geral booleano nos dois sentidos).
- [x] **CA4** — Dado que uma capacidade já foi auto-anexada pelo `init()`,
      Quando o dev chama o `attachX()` correspondente manualmente de novo
      (ex.: código legado que já fazia isso antes desta mudança), Então a
      segunda chamada é um no-op seguro — nenhum `console.log`/requisição/
      frame é reportado em duplicidade, e a função de detach retornada não
      quebra nada quando invocada. **Testado:** unitário (chamar
      `attachConsole()` manualmente após o auto-attach e confirmar um único
      `log/entry` para um único `console.log()`). Mecanismo:
      `SpyglassCore.markAttached()`, um `Set` por core.
- [x] **CA5** — Dado que o app chama `handle.close()` e depois `init()` de
      novo (novo core), Quando isso acontece, Então o auto-attach roda do
      zero pro novo core — não fica "preso" achando que uma capacidade já
      está anexada por causa de um core anterior já fechado. **Testado:**
      unitário (`init` → `close` → `init` de novo, hello do segundo core
      também contém as três capacidades). `handle.close()` também desanexa
      os adapters auto-anexados do core anterior, evitando patches
      acumulados a cada ciclo `init`/`close`.

## Checklist de impacto

- **Autenticação / autorização:** n/a.
- **Isolamento de dados:** n/a.
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a.
- **Dados pessoais / privacidade:** nenhum dado novo é coletado — só muda
  *quando* os adapters de console/network/performance (que já existem)
  passam a rodar. Vale lembrar (já documentado) que `attachNetwork`
  captura corpo de request/response por padrão — isso não muda aqui, só a
  forma como o adapter é ativado.
- **Notificações / comunicação externa:** n/a.
- **Interface / experiência:** nenhuma mudança na UI do desktop — os dados
  passam a chegar mais cedo/sempre em dev, mas as views já existentes
  (Console, Network, Performance) continuam iguais.
- **Migração de dados / schema:** nenhuma mudança de contrato de wire
  protocol.
- **Compatibilidade / integração externa:** aditivo. Quem já chama
  `attachConsole()`/`attachNetwork()`/`attachPerformance()` manualmente
  continua funcionando (CA4 garante que a chamada duplicada é inofensiva).
  Já que o pacote ainda não foi publicado no npm (specs 0002/0003), não há
  usuário externo hoje que dependa do comportamento atual "nada acontece
  sem chamada manual".
- **Performance / escala:** patchar console/network tem custo de runtime
  contínuo (todo `console.log`/request passa por um wrapper extra) —
  por isso o default é **só em dev** (CA2), mitigando exatamente esse
  risco em produção sem o dev precisar decidir nada.

## Fora de escopo

- Auto-attach de navegação, estado (Redux/Zustand/MobX/...) ou storage
  (AsyncStorage/MMKV/...) — continuam exigindo wiring manual, porque
  dependem de uma referência que só existe no código do app e não há como
  o SDK descobrir sozinho (sem um plugin de babel fazendo instrumentação
  estática, que é uma mudança de escopo muito maior).
- Passar opções customizadas (ex.: `levels` do `attachConsole`,
  `captureBody: false` do `attachNetwork`) para os adapters auto-anexados
  nesta v1 — quem precisa de opções customizadas desliga o auto-attach
  daquela capacidade especificamente (CA3) e chama o adapter manualmente
  como hoje.
- Auto-detectar se `@react-navigation/native`/Redux/etc. estão instalados
  pra sugerir adapters — fica como ideia futura, não parte desta spec.

## Riscos e dependências

- Depende do padrão de detecção de ambiente já implementado pra
  `diagnostics` (`isDevEnvironment()` em `packages/sdk/src/diagnostics.ts`)
  — reaproveitar em vez de duplicar a lógica de `__DEV__`/`NODE_ENV`.
- Risco de um dev *querer* que console/network fiquem desligados em dev
  por algum motivo (ex.: volume de log muito alto atrapalhando outra
  ferramenta) — mitigado pelo override por capacidade (CA3).
- Idempotência (CA4) precisa de um mecanismo de "já anexado" que sobrevive
  a múltiplas chamadas mas reseta num `init()` novo (CA5) — decisão de
  implementação, não de produto; qualquer mecanismo que satisfaça os dois
  CAs serve.

## Métrica de sucesso

Um dev que só chama `init({ appName })` em desenvolvimento, sem tocar em
nenhum `attachX()`, já vê logs de console, requisições de rede e stalls de
performance aparecendo no desktop — validado manualmente repetindo o
cenário desta sessão (app conectado, mas "mudo").

## Plano de teste

- **Automatizado (vitest, `packages/sdk`):**
  - `init()` em ambiente dev (mock de `__DEV__`/`NODE_ENV`) resulta em
    `hello.capabilities` contendo `"console"`, `"network"`, `"performance"`.
  - `init()` em ambiente de produção resulta em `hello.capabilities` sem
    essas três (a menos que outro adapter as registre manualmente).
  - Override por capacidade (`autoAttach: { network: false }` ou
    equivalente) muda o resultado independentemente do ambiente.
  - Chamar `attachConsole()` manualmente depois do auto-attach não duplica
    o `log/entry` de um único `console.log()`.
  - `init()` → `close()` → `init()` de novo re-executa o auto-attach no
    novo core (não herda estado do core anterior).
- **Manual/ao vivo:** repetir a integração desta sessão num app real —
  `init({ appName })` sozinho, sem nenhum `attachX()`, e confirmar que
  Console/Network/Performance aparecem no desktop.
