# 0008 — Monitoramento de memória/armazenamento/swap do dispositivo e do app + limpar caches

- **Status:** em desenvolvimento
- **RICE:** R 5 · I 2 · C 80% · E 6 → **score 1.3**
- **Criada em:** 2026-08-13

## Contexto e problema

O usuário pediu: "pegar memoria tam do celular e quanto de memoria e
espaço a aplicação tá usando no momento, quanto de swap, e uma forma de
liberar memoria pela ferramenta."

A primeira arquitetura investigada — o SDK embarcado no app RN lendo
esses números via bibliotecas nativas (`react-native-device-info`,
`react-native-memory-footprint`) e mandando pelo protocolo já existente
— tem um custo real: exige rebuild nativo do app (não funciona no Expo
Go) e quebra a promessa atual do SDK de ser 100% JS, zero código
nativo, instala-e-usa em qualquer setup. Perguntei ao usuário se topava
esse trade-off; a resposta foi **"veja outra forma, android e o adb
memory e no ios?"** — pedindo para investigar o caminho pelo lado do
desktop.

Essa investigação (com verificação ao vivo contra um emulador Android
15 e o toolchain macOS local, não só busca) mudou a arquitetura pra
melhor: **o desktop já roda `adb` para outra finalidade**
(`apps/desktop/src-tauri/src/adb.rs`, hoje só aplica `adb reverse` pra
encaminhar a porta do WebSocket). Dá pra estender esse mesmo padrão
(`Command` argv-only, nunca shell, com timeout) pra ler memória — sem
mudar uma linha do SDK, sem dependência nativa nova, funcionando em
build de release e no Expo Go igualmente, porque o comando roda de
fora do processo do app.

**A única parte que continua precisando do SDK é "limpar caches"** —
por natureza, só o próprio processo do app pode acionar seu GC do
Hermes ou limpar seu cache de imagem; isso o desktop não alcança de
fora. Essa parte reaproveita exatamente o canal Desktop→SDK já
construído nesta sessão para `storage/write`/`state/write` (spec 0007
/ 0007-state).

### O que a investigação confirmou, resumido

| Capacidade | Android | iOS Simulator | iOS device físico |
|---|---|---|---|
| Memória total do dispositivo | ✅ `adb shell cat /proc/meminfo` (`MemTotal`) | ❌ não existe — Simulator usa a RAM do Mac host, mostrar isso como "memória do device" engana o usuário | ❌ nenhuma API expõe isso (nem `libimobiledevice`); só tabela estática por modelo, fora do escopo agora |
| Memória do app (RSS/PSS) | ✅ `adb shell dumpsys meminfo <pacote>` — sem root, sem app debuggable, funciona em build release | ✅ `/usr/bin/footprint -p <pid>` (binário do próprio macOS, não precisa Xcode completo, sem sudo) | ❌ sem solução leve — só `pymobiledevice3` (Python, exige túnel com `sudo` no iOS 17+); fora do escopo v1 |
| Swap | ✅ `TOTAL SWAP PSS` no mesmo `dumpsys meminfo` | ❌ não existe conceito de swap no Simulator | ❌ |
| Espaço em disco do app | Fora de v1 (sem API limpa equivalente já mapeada; adiado) | Fora de v1 | Fora de v1 |
| Liberar memória | Via SDK: GC do Hermes (`global.gc()`, existe em build de produção) + `Image.clearMemoryCache()` do `expo-image` se presente — **só os próprios caches do app**, nenhum app consegue pedir memória de volta ao SO | idem | idem |

Custo de poll: ~210ms por ciclo completo (achar app em foreground +
memória do app + memória do sistema) a cada 2s — roda fora das threads
do app, ao contrário da alternativa nativa (que teria custo dentro do
próprio app e é limitada/throttled pelo Android 10+).

**Achado importante que muda o design**: o comando que eu ia usar pra
detectar automaticamente qual app está em primeiro plano
(`mResumedActivity`) **não existe mais no Android 15**. A alternativa
mais robusta (`dumpsys activity lru`, linha `TOP`) ainda tem furos reais
(Expo Go sempre aparece como `host.exp.exponent`, split-screen mostra
dois processos "TOP"). Por isso o design abaixo **não tenta
autodetectar** — o usuário escolhe o dispositivo/pacote uma vez (com
uma sugestão pré-preenchida), e a ferramenta lembra a escolha.

## Personas / usuários afetados

- **Dev investigando um vazamento de memória ou lentidão** — quer ver a
  memória do app subir ao vivo enquanto reproduz um fluxo, sem precisar
  abrir o Android Studio Profiler ou o Instruments à parte.
- **Dev testando em device de pouca RAM** — quer saber quanto de RAM o
  dispositivo tem no total e quanto sobra, pra entender se um crash é
  por falta de memória.

## Histórias de usuário

Como dev com um app Android conectado, quero ver a memória total do
dispositivo, a memória (e swap) que meu app está usando agora, e um
gráfico dessas métricas ao longo do tempo, para identificar picos e
vazamentos sem sair do Spyglass.

Como dev com um app iOS rodando no Simulator, quero ver a memória
(`phys_footprint`) que meu app está usando agora, com o mesmo aviso
visual de que "memória do dispositivo" não se aplica ao Simulator, para
não confundir esse número com o de um device físico.

Como dev, quero um botão "Limpar caches do app" com uma explicação
clara do que ele realmente faz (GC do heap JS + cache de imagem, não
"libera RAM do sistema"), para forçar uma medição mais limpa sem
prometer algo que nenhum app de terceiros consegue entregar.

## Critérios de aceite

- [ ] **CA1** — Dado um app Android conectado e pelo menos um device
      com `adb` disponível, Quando o dev abre o painel de Memória na
      aba Performance, Então vê um seletor de device (se houver mais de
      um) e um seletor de pacote (populado via `pm list packages -3`,
      com uma sugestão pré-selecionada vinda de `dumpsys activity lru`).
- [ ] **CA2** — Dado um device+pacote selecionados, Quando os dados
      chegam, Então o painel mostra memória total do dispositivo
      (`MemTotal`), memória do app (`TOTAL RSS`, rotulada como física)
      e swap do app (`TOTAL SWAP PSS`), atualizando a cada 2s, com um
      gráfico dos últimos ~60 pontos no mesmo estilo do `FpsChart`
      existente.
- [ ] **CA3** — Dado um app iOS conectado rodando no Simulator, Quando
      o dev seleciona o Simulator+processo, Então vê `phys_footprint`
      atualizando a cada 2s, **sem** nenhum card de "memória do
      dispositivo" ou "swap" (não existem nesse contexto).
- [ ] **CA4** — Dado um app iOS conectado num device físico, Quando o
      dev abre o painel de Memória, Então vê uma mensagem explícita "não
      suportado ainda neste device" em vez de um card vazio ou quebrado.
- [ ] **CA5** — Dado `allowRemoteWrites` habilitado no app conectado
      (mesmo gate dev-only de spec 0007/0007-state), Quando o dev clica
      "Limpar caches do app", Então o SDK roda `global.gc()` (se
      disponível) e `Image.clearMemoryCache()`/`clearDiskCache()` do
      `expo-image` (se instalado), e o desktop mostra um status
      pending→applied/failed, igual ao padrão de escrita já existente.
- [ ] **CA6** — Dado o app **não** anuncia a capability
      `memory:clear-cache` (produção, ou SDK antigo), Quando o dev abre
      o painel, Então o botão de limpar caches nem aparece — sem
      esperar timeout.
- [ ] **CA7** — Dado o painel de Memória não está montado (dev noutra
      aba), Quando o tempo passa, Então nenhum comando `adb`/`footprint`
      é disparado — o poll só roda com o painel visível.

## Checklist de impacto

- **Autenticação / autorização:** n/a — leitura via `adb`/`footprint`
  já exige que o usuário tenha USB debugging habilitado no device (o
  mesmo requisito que já existe pra qualquer conexão Android nesta
  ferramenta); "limpar caches" usa o mesmo hard-gate dev-only de
  `allowRemoteWrites` que storage/state write já têm.
- **Isolamento de dados:** n/a — cada leitura é escopada por `-s
  <serial>` (Android) ou PID específico (iOS Sim), nunca lê outro
  device/processo além do selecionado.
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a — mesmo nível de log que o resto
  da ferramenta (nenhum específico).
- **Dados pessoais / privacidade:** n/a — números de memória agregados,
  nenhum dado de usuário do app.
- **Notificações / comunicação externa:** n/a.
- **Interface / experiência:** central ao pedido — novo painel dentro
  da aba Performance; precisa deixar claro, na própria UI, quais
  números existem em cada plataforma (não esconder a assimetria
  Android/iOS atrás de um card vazio).
- **Migração de dados / schema:** nenhuma — os dados de memória/swap
  **não** passam pelo protocolo SDK↔Desktop existente (não é um
  `MessageType` novo, é uma fonte de dados paralela que o desktop
  puxa direto via `adb`/`footprint`); só o comando de limpar caches usa
  o protocolo (2 mensagens novas: `memory/clear-cache` /
  `memory/clear-cache-result`, mesmo formato de `state/write`).
- **Compatibilidade / integração externa:** depende de `adb` já
  localizável (mesma lógica de `find_adb()` já existente) e, no macOS,
  dos binários `/usr/bin/footprint`/`pgrep`/`xcrun simctl` — sem
  dependência de terceiros nova.
- **Performance / escala:** poll a cada 2s custa ~210ms por ciclo no
  lado do desktop (fora das threads do app); só roda com o painel
  montado (CA7). Sem impacto perceptível no app inspecionado.

## Fora de escopo

- **Memória em device físico iOS** — sem solução leve; a única rota
  real (`pymobiledevice3`) exige Python empacotado + `sudo` pra iOS
  17+ (túnel RemoteXPC), custo de arquitetura desproporcional pro
  valor. Revisitar como v2 se a crate Rust `idevice` amadurecer o
  suporte a DVT sysmon.
- **Memória total do dispositivo físico iOS** — sem API; workaround
  seria tabela estática `ProductType → RAM` (mapeamento conhecido e
  fixo por modelo) — pequeno o suficiente pra ser um adendo futuro, mas
  fora desta v1 pra não inflar o escopo.
- **Espaço em disco ocupado pelo app** (Android/iOS) — o pedido original
  menciona "espaço", mas isso não foi pesquisado com o mesmo rigor
  nesta rodada (a pesquisa anterior, pré-pivot pro adb, mapeou só a
  rota SDK-side via `expo-file-system`/native recursivo, que não se
  aplica mais). Fica pra uma spec/rodada de pesquisa separada.
- **Autodetecção automática de device/pacote** — deliberadamente não
  implementada (ver achado sobre `mResumedActivity` estar morto e Expo
  Go sempre aparecer como `host.exp.exponent`); v1 é seleção manual com
  sugestão.
- **Gráfico comparável entre plataformas** — Android reporta PSS+swap
  combinados no total, iOS reporta `phys_footprint` — métricas
  diferentes por definição; não colocar no mesmo eixo nem comparar
  números entre plataformas.
- **Windows/Linux para a metade iOS** — `footprint`/`pgrep`/`simctl`
  são binários macOS; nesses SOs só a metade Android da feature existe.

## Riscos e dependências

- **Formato do `dumpsys meminfo` varia entre versões do Android**
  (`TOTAL:` virou `TOTAL PSS:`, `TOTAL SWAP (KB):` virou `TOTAL SWAP
  PSS:` em algum ponto entre Android 9 e 15) — o parser precisa ser
  defensivo (regex com grupos opcionais), não split por coluna fixa.
- **`TOTAL PSS` do Android já inclui páginas em swap (ZRAM)** — se o
  painel mostrar PSS e swap lado a lado sem essa nota, o total parece
  duplicado. Preferir `TOTAL RSS` como "física" e `TOTAL SWAP PSS`
  separado (já é o que o CA2 especifica).
- **Sem `adb`/Xcode instalado**: já existe tratamento equivalente pra
  `adb` ausente em `find_adb()` (spec 0002) — reaproveitar a mesma UX
  de erro ("adb não encontrado, veja X"), não inventar uma nova.
- **Depende da spec 0007/0007-state's infraestrutura de write-back**
  (pendingWrites-style state machine, `allowRemoteWrites` gate) pro
  botão de limpar caches — já entregue nesta sessão.

## Métrica de sucesso

Não há telemetria neste produto (ferramenta local, sem analytics) — o
sinal de sucesso é qualitativo: o dev consegue, ao vivo, ver a memória
subir durante um fluxo que sabidamente vaza memória, sem sair do
Spyglass ou abrir o profiler nativo da plataforma.

## Plano de teste

- **Automatizado:**
  - `apps/desktop/src-tauri/src/adb.rs` — testes de parsing puro
    (mesmo padrão dos testes existentes de `parse_devices_output`):
    parser de `/proc/meminfo`, parser de `dumpsys meminfo <pkg>`
    (incluindo as duas variantes de formato, `TOTAL:` vs `TOTAL PSS:`),
    parser de `dumpsys activity lru` pra achar a linha `TOP`.
  - Novo módulo macOS-only (`#[cfg(target_os = "macos")]`) — parser da
    saída JSON do `footprint -j`.
  - `packages/sdk/src/__tests__/memoryClear.test.ts` — mesmo padrão de
    `stateWrite.test.ts`: capability só em dev, `global.gc` chamado
    quando existe, `expo-image` chamado só se "instalado" (mock),
    resposta ok/erro.
  - `apps/desktop/src/state/__tests__/connection.test.ts` — novo bloco
    pra `pendingCacheClear`/`sendClearCache`, espelhando os já
    existentes.
- **Manual/ao vivo:**
  1. (CA1, CA2) Conectar um app Android real (emulador ou device),
     abrir o painel, escolher device/pacote, confirmar que os números
     batem com o Android Studio Profiler pro mesmo processo.
  2. (CA3) Mesmo fluxo no iOS Simulator, comparar com o gauge de
     memória do Xcode.
  3. (CA4) Conectar um app num iPhone físico, confirmar a mensagem de
     "não suportado".
  4. (CA5, CA6) Rodar `Image.clearMemoryCache()` manualmente antes/depois
     do botão pra confirmar que o número cai; testar com
     `allowRemoteWrites: false` pra confirmar que o botão some.
  5. (CA7) Trocar de aba, confirmar via log/Activity Monitor do Mac que
     nenhum `adb`/`footprint` roda enquanto o painel não está visível.
