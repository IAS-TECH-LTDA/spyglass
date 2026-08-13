# 0009 — Auto-update do desktop via GitHub Releases

- **Status:** em desenvolvimento
- **RICE:** R 8 · I 3 · C 90% · E 5 → **score 4.3**
- **Criada em:** 2026-08-13

## Contexto e problema

Até esta spec, `apps/desktop` não tinha nenhum caminho de distribuição: o
`README.md` dizia explicitamente "Not published; download/build it to run
locally", não existia repositório no GitHub (`git remote -v` vazio), não
existia CI, e a spec 0003 tinha adiado o empacotamento do desktop de
propósito ("fica como pré-requisito documentado para uma spec futura").

O pedido do usuário foi direto: "como colocamos atualização automática sem
precisar ficar gerando toda hora um novo build do projeto desktop". Vale
registrar a correção de premissa que abriu esta spec: **auto-update não
elimina o build** — toda versão nova continua exigindo um build completo
por plataforma. O que muda é *quem* builda (sai da máquina do mantenedor e
vai para o GitHub Actions, disparado por uma tag git) e o que o usuário
final faz a partir da instalação inicial, que passa a ser nada.

Decisões tomadas com o usuário antes do desenho: distribuição pública via
GitHub Releases (grátis, sem servidor próprio); Apple Developer Program
disponível, então codesign + notarização entram já na v1 em vez de ficarem
como débito; plataformas-alvo macOS (Intel + Apple Silicon, build
universal), Windows e Linux; repositório criado com o slug
`IAS-TECH-LTDA/spyglass` — o mesmo que `packages/protocol/package.json` e
`packages/sdk/package.json` já publicavam no npm antes de o repo existir,
então usar outro slug teria quebrado os metadados desses dois pacotes.

## Personas / usuários afetados

- **Usuário final do Spyglass** — instala uma vez e, a partir daí, nunca
  mais reinstala manualmente; o app se atualiza sozinho.
- **Mantenedor (hoje, um só)** — deixa de gerar e distribuir builds na mão;
  passa a taguear e deixar o CI fazer o resto.

## Histórias de usuário

Como usuário do Spyglass, quero que o app me avise quando há uma versão
nova e me deixe atualizar com um clique, para nunca precisar procurar e
baixar um instalador manualmente.

Como usuário no meio de uma sessão de debug, quero decidir *quando*
reiniciar para aplicar um update, para não perder o foco nem o estado da
tela no momento em que ele fica disponível.

Como mantenedor, quero que uma tag git dispare o build assinado das três
plataformas e publique a release sozinho, para não precisar buildar e
assinar manualmente em cada máquina.

## Decisões de design

- **Banner não-bloqueante, não modal, não item de tray.** O Spyglass fica
  aberto em segundo plano enquanto o dev debuga um app RN — um modal
  roubando foco nesse momento (possivelmente enquanto o dev olha um log
  que acabou de chegar) seria hostil ao próprio uso do produto. O tray
  atual (`main.rs`, `TrayIconBuilder`) não tem menu e o clique esquerdo só
  foca a janela; anexar um menu de update mudaria esse comportamento no
  macOS por um ganho que não compensa a v1.
- **Download e restart são dois passos separados, nunca automáticos.**
  `lib/updater.ts` expõe `checkForUpdate` → `downloadUpdate` →
  `installAndRelaunch` como três chamadas distintas; o `state/updater.ts`
  só chama a instalação/relaunch quando o usuário clica "Restart now" no
  estado `ready`. Reiniciar derruba os WebSockets de todos os apps
  conectados — o `Transport` do SDK reconecta com backoff, mas o `registry`
  do desktop perde o cache de envelopes da sessão (logs, requests). Isso
  não pode acontecer sem uma escolha explícita, num momento escolhido pelo
  usuário.
- **`apps/desktop` tem ciclo de versão próprio, fora do lockstep
  protocol↔sdk.** Ver `CLAUDE.md`, seção "Publishing", para o raciocínio
  completo — resumo: o lockstep existente é uma restrição de
  compatibilidade de *código-fonte* (o SDK importa o `dist/` do protocol; o
  Rust espelha os tipos à mão), enquanto a compatibilidade real de *wire*
  já é garantida por `PROTOCOL_VERSION`/o campo `v` do envelope,
  independentemente dos números de versão baterem. Amarrar o desktop a
  esse lockstep forçaria publish de npm por um ajuste de CSS, ou um release
  de 3 plataformas por um fix isolado do SDK — sem nenhum ganho real de
  compatibilidade.
- **`tauri.conf.json`'s `version` aponta para `../package.json`** em vez de
  duplicar o número — uma fonte de verdade a menos para dessincronizar.
  `src-tauri/Cargo.toml` é guardado contra o mesmo valor por
  `apps/desktop/src/__tests__/version.test.ts` (mesmo padrão de
  `packages/sdk/__tests__/version.test.ts` guardando `SDK_VERSION`).
- **Assinatura minisign (updater) e codesign/notarização Apple (SO) são
  mecanismos independentes.** A primeira é obrigatória e grátis — é o que
  o updater verifica antes de aplicar qualquer pacote, protegendo contra um
  comprometimento da conta do GitHub virar canal de distribuição de
  malware; o Tauri v2 se recusa a operar sem ela. A segunda é o que faz o
  Gatekeeper aceitar o app na instalação inicial. Neste app especificamente
  a segunda também importa para *updates subsequentes*: o app escuta em
  `0.0.0.0:8098` (`ws_server.rs`), e tanto a aprovação do Application
  Firewall quanto o consentimento de rede local do macOS 15+ são mantidos
  contra a identidade de assinatura — sem uma Developer ID estável, cada
  update (que reescreve o binário) arriscaria reabrir esses prompts.
- **CSP não muda.** O download e a verificação de assinatura do updater
  acontecem inteiramente no processo Rust (via `reqwest`, dentro do
  plugin), nunca no webview — CSP é aplicada pelo WebView a requisições
  originadas do documento, e o `check()`/`downloadAndInstall()` do lado JS
  são só `invoke()` sobre o canal IPC já permitido por
  `connect-src 'self' ipc: http://ipc.localhost`.

## Critérios de aceite

- [ ] **CA1** — Dado o app instalado e conectado à internet, Quando se
      passam ~10s após o boot (ou a cada 6h de app aberto), Então ele
      consulta `https://github.com/IAS-TECH-LTDA/spyglass/releases/latest/download/latest.json`
      silenciosamente, sem qualquer UI visível se não houver update.
- [ ] **CA2** — Dado que há uma versão mais nova publicada, Quando o check
      encontra o update, Então aparece um banner discreto no topo (acima
      da topbar) com a versão e as notas, e os botões "Update"/"Later".
- [ ] **CA3** — Dado que o usuário clica "Later", Quando a mesma versão
      continuar sendo a mais recente, Então o banner não reaparece
      (`dismissedVersion` persistido) — mas reaparece assim que uma versão
      *nova* sair.
- [ ] **CA4** — Dado que o usuário clica "Update", Quando o download
      termina, Então o banner muda para "ready" com um botão explícito
      "Restart now" — a instalação e o relaunch **não** acontecem
      automaticamente ao fim do download.
- [ ] **CA5** — Dado que o usuário clica "Restart now", Quando o app
      reabre, Então ele está na versão nova, o pacote foi verificado contra
      a chave pública minisign compilada no binário, e um app RN conectado
      volta a conectar sozinho (backoff do `Transport`) em segundos.
- [ ] **CA6** — Dado um release novo publicado (tag `desktop-v*`), Quando o
      workflow roda, Então as três plataformas (macOS universal, Windows,
      Linux) são buildadas, assinadas e o `latest.json` resultante lista
      as quatro chaves de plataforma (`darwin-aarch64`, `darwin-x86_64`,
      `windows-x86_64`, `linux-x86_64`), cada uma com `signature` não
      vazia.
- [ ] **CA7** — Dado uma tag `desktop-v0.1.1` cujo `apps/desktop/package.json`
      ainda diz `0.1.0`, Quando o workflow roda, Então o job `check-tag`
      falha antes de qualquer build, sem publicar nada.
- [ ] **CA8** — Dado um `.dmg` baixado pelo navegador e instalado em
      `/Applications` numa máquina limpa, Quando o app abre pela primeira
      vez, Então o Gatekeeper não bloqueia (notarização válida), e um
      update subsequente aplicado pelo próprio app **não** reabre os
      prompts de firewall/rede local vistos na instalação inicial.

## Checklist de impacto

- **Autenticação / autorização:** n/a para o updater em si. A conta Apple
  Developer e os secrets do GitHub (minisign, certificado) são as únicas
  credenciais novas envolvidas — vivem só em GitHub Secrets, nunca no
  repositório.
- **Isolamento de dados:** n/a — o endpoint de update é público e não
  carrega nenhum dado do usuário; é só "qual a versão mais recente".
- **Limites / cotas / billing:** GitHub Actions em repositório público é
  grátis, incluindo runners macOS/Windows/Linux — sem custo de CI. Custo
  recorrente novo: Apple Developer Program (já assinado pelo usuário,
  fora do escopo desta spec). Windows e um eventual mirror ficam sem custo
  adicional nesta v1.
- **Auditoria / rastreabilidade:** cada release é uma entrada no GitHub
  Releases, com o `latest.json` e os artefatos assinados publicamente
  auditáveis.
- **Dados pessoais / privacidade:** n/a — nenhum dado de telemetria é
  coletado no processo de check/update (este produto não tem telemetria).
- **Notificações / comunicação externa:** o banner em si é a única
  comunicação; nenhum e-mail/push externo.
- **Interface / experiência:** central ao pedido — ver "Decisões de
  design" acima.
- **Migração de dados / schema:** nenhuma — não é uma mudança de protocolo
  SDK↔Desktop, é só distribuição do binário do desktop.
- **Compatibilidade / integração externa:** depende de
  `tauri-plugin-updater`/`tauri-plugin-process` (novos), `tauri-action`
  (CI), e da conta/certificado Apple Developer para notarização.
- **Performance / escala:** um GET HTTPS leve a cada ~6h; download do
  pacote de update só ocorre sob ação explícita do usuário.

## Fora de escopo

- **Certificado de code signing para Windows** — sem ele, o SmartScreen
  avisa na primeira instalação baixada pelo navegador (não afeta updates
  aplicados pelo próprio app). Azure Trusted Signing (~US$10/mês) é o
  caminho mais barato quando/se isso importar.
- **Homebrew cask / winget / outros gerenciadores de pacote.**
- **Canais de release (beta/stable) e rollback de versão** — não existe
  downgrade automático; um release ruim exige publicar imediatamente uma
  versão corrigida (não há "voltar" no lado do cliente).
- **Delta updates** — o Tauri baixa o pacote inteiro a cada versão nova.
- **Menu de tray com "Check for updates…"** — descartado deliberadamente
  na v1 (ver "Decisões de design"); pode voltar como v2 se pedido.

## Riscos e dependências

- **`latest.json` incompleto por corrida na matriz do CI** — o
  `tauri-action` faz merge do `latest.json` já publicado com a entrada da
  plataforma atual; legs concorrentes correm risco clássico de
  read-modify-write. Mitigado com `max-parallel: 1` no job `build` de
  `.github/workflows/release.yml` — custa alguns minutos extra de release,
  elimina a classe inteira de bug.
- **`pnpm build` faltando no CI** — `tauri.conf.json`'s `beforeBuildCommand`
  só roda `vite build`, que não builda `packages/protocol`; sem o
  `pnpm build` da raiz antes do `tauri-action`, o Vite falha resolvendo
  `spyglass-protocol` num checkout limpo. Coberto explicitamente no
  workflow com um comentário.
- **Variáveis de ambiente de assinatura na versão errada** — Tauri v1
  usava `TAURI_PRIVATE_KEY`/`TAURI_KEY_PASSWORD`; v2 usa
  `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Usar o
  nome errado falha silenciosamente — o build passa mas sai sem `.sig`, e
  o updater recusa o pacote em runtime sem uma mensagem óbvia.
- **App Translocation no macOS** — se o usuário abrir o `.app` de dentro do
  `.dmg` montado (ou de `~/Downloads` com quarantine), o macOS roda a
  partir de um caminho somente-leitura e o updater não consegue se
  substituir. Mitigado só via instrução no README ("arraste para
  /Applications antes de abrir"); sem detecção automática nesta v1.
- **Perda da chave privada minisign** — consequência irreversível: a
  pubkey fica compilada em todo binário já distribuído, então perder a
  privada torna todo app instalado incapaz de aceitar updates futuros, sem
  saída além de pedir reinstalação manual a todos. Mitigado só por
  processo (backup em dois lugares) — nenhuma proteção técnica cobre isso.
- **Depende da conta Apple Developer do usuário** já estar configurada
  fora desta spec (certificado Developer ID Application exportado,
  app-specific password gerada) — os secrets do GitHub Actions
  (`APPLE_*`, `TAURI_SIGNING_*`) são pré-requisito manual, não algo que
  este código resolve sozinho.

## Métrica de sucesso

Sem telemetria neste produto — sinal qualitativo: um release
`desktop-v0.1.1` publicado é recebido e aplicado por uma instalação
`0.1.0` existente sem qualquer intervenção manual, e sem reabrir prompts
de permissão do SO que já tinham sido concedidos.

## Plano de teste

- **Automatizado:**
  - `apps/desktop/src/__tests__/version.test.ts` — guarda
    `package.json`/`Cargo.toml`/`tauri.conf.json` contra divergência de
    versão.
  - `.github/workflows/release.yml`'s job `check-tag` — guarda a tag git
    contra `package.json` antes de qualquer build.
- **Manual/ao vivo, em degraus (do mais barato ao mais realista):**
  1. **Ensaio local sem GitHub** — build local de duas versões, servidas
     por um servidor estático + `latest.json` escrito à mão
     (`dangerousInsecureTransportProtocol: true` só nesse teste, nunca
     commitado); confirma banner → download → "Restart now" → relaunch.
  2. **Repo de ensaio descartável** — como
     `releases/latest/download/latest.json` **ignora drafts e
     prereleases**, o único jeito de exercitar o caminho real é publicar
     releases de verdade; melhor fazer isso num repo separado e
     descartável antes do primeiro release público, inspecionando o
     `latest.json` gerado (as quatro chaves de plataforma, `.sig` presente
     em cada artefato).
  3. **Máquina limpa** — baixar o `.dmg` pelo navegador (só o navegador
     aplica `com.apple.quarantine`) numa VM/máquina que nunca rodou o
     Spyglass; confirmar Gatekeeper limpo (`spctl -a -vvv -t install`),
     aceitar os prompts de firewall/rede local, então aplicar um update e
     confirmar que os prompts **não** reaparecem.
  4. **Release público real** — `desktop-v0.1.0` seguido de
     `desktop-v0.1.1` com uma mudança trivial e visível, para confirmar o
     ciclo completo fim-a-fim no repositório real.
