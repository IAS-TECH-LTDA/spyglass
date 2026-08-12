# 0003 — Preparação para publicação no npm + tela de conexão do desktop

- **Status:** em desenvolvimento
- **RICE:** R 6 · I 3 · C 100% · E 2 → **score 9.0**
- **Criada em:** 2026-08-03

## Contexto e problema

Publicar `spyglass-protocol` e `spyglass-react` no npm hoje produziria
pacotes **quebrados**: ambos são `"private": true` (bloqueia `npm publish`),
o SDK depende do protocol via `"file:../protocol"` (vai verbatim no tarball
e resolve para um caminho inexistente na máquina do consumidor), e — o mais
traiçoeiro — nenhum dos dois tem campo `"files"`, então o npm cai no
`.gitignore` como fallback, que tem `dist/` — publicando um **pacote vazio**
que instala e falha em runtime.

Complementarmente, para o SDK autodetectar host (spec 0002) ser útil na
prática, o desktop precisa mostrar ao dev os IPs de LAN reais da máquina e
automatizar o `adb reverse` para Android — hoje a tela vazia do desktop
mostra um texto fixo `ws://localhost:8098`, errado justamente para quem mais
precisa de ajuda (device físico).

## Personas / usuários afetados

- **Mantenedor do projeto** — precisa rodar `pnpm publish -r` com confiança
  de que o pacote resultante funciona.
- **Dev consumindo o SDK publicado** — instala via npm/yarn/pnpm normal, sem
  saber que hoje viria quebrado.
- **Dev sem app conectado ainda** — abre o desktop e precisa de instruções
  acionáveis, não um texto genérico.

## Histórias de usuário

Como mantenedor, quero rodar um único comando de release e ter certeza de
que o tarball publicado contém o `dist/` e resolve suas dependências
internas corretamente, para não descobrir um pacote quebrado só depois que
alguém tentar instalar.

Como dev abrindo o desktop pela primeira vez sem nenhum app conectado, quero
ver o comando exato pra rodar (com o IP certo já preenchido) para o meu
cenário (simulador/emulador/device físico), para não precisar caçar meu
próprio IP de rede.

## Critérios de aceite

- [ ] **CA1** — Dado o pacote `spyglass-react` empacotado via `pnpm pack`,
      Quando inspeciono o tarball, Então `dist/` está presente com todos os
      18 subpaths de `exports` resolvendo para arquivos reais, e
      `dist/__tests__/` **não** está presente.
- [ ] **CA2** — Dado o mesmo tarball, Quando leio seu `package.json`, Então
      a dependência de `spyglass-protocol` aparece como um range real
      (ex.: `^0.1.0`), nunca como `workspace:^` nem `file:...`.
- [ ] **CA3** — Dado os manifestos publicados, Quando um dev instala via
      `npm install spyglass-react`, Então a instalação resolve sem erro e
      `import { init } from "spyglass-react"` funciona.
- [ ] **CA4** — Dado nenhum app conectado no desktop, Quando abro a tela
      principal, Então vejo os IPs de LAN reais desta máquina (não
      `localhost` fixo), um snippet de `init()` por cenário (simulador,
      emulador, device físico), e o status do `adb reverse` automático.
- [ ] **CA5** — Dado um device Android conectado via USB com `adb`
      disponível, Quando o desktop está aberto, Então o `adb reverse
      tcp:8098 tcp:8098` é aplicado automaticamente, sem ação manual, e a
      tela mostra esse status.
- [ ] **CA6** — Dado que o `adb reverse` foi perdido (ex.: reboot do
      device), Quando o watcher do desktop roda seu próximo ciclo (até 10s),
      Então o reverse é reaplicado automaticamente.
- [ ] **CA7** — Dado que `adb` não está disponível no PATH nem nos caminhos
      padrão de SDK, Quando o desktop tenta localizar, Então a tela mostra
      claramente que não foi encontrado e onde procurou, sem travar nem
      gerar erro não tratado.

## Checklist de impacto

- **Autenticação / autorização:** n/a.
- **Isolamento de dados:** n/a.
- **Limites / cotas / billing:** n/a — pacote é gratuito/open-source (MIT).
- **Auditoria / rastreabilidade:** n/a.
- **Dados pessoais / privacidade:** IPs de LAN exibidos são da própria
  máquina do usuário, não de terceiros. Nenhum dado é enviado para fora da
  rede local.
- **Notificações / comunicação externa:** n/a.
- **Interface / experiência:** nova tela de conexão (`ConnectView`)
  substitui o empty-state estático; reaproveita padrões visuais já
  existentes (`.storage-chip`, `.status-ok/.status-error`, `.dot`), sem
  introduzir design system novo.
- **Migração de dados / schema:** nenhuma mudança de contrato de wire
  protocol.
- **Compatibilidade / integração externa:** mudança de versionamento de
  dependência interna (`file:` → `workspace:^`) não afeta consumidores
  externos, só o publish. `apps/desktop` permanece `private: true` — não é
  publicado.
- **Performance / escala:** watcher de `adb` roda a cada 10s (60s quando
  `adb` ausente) só enquanto o desktop está aberto; custo é o de um spawn
  de processo local, desprezível.

## Fora de escopo

- CI/CD automatizado de release (GitHub Actions) — fica manual via script
  `pnpm release` por enquanto.
- Autenticação/token de pareamento no WebSocket — item de segurança
  separado no backlog (bind em `0.0.0.0` sem auth já existe hoje, esta spec
  só torna isso mais visível ao expor os IPs).
- Empacotamento/distribuição do próprio app desktop (`tauri.conf.json` tem
  `bundle.active: false`) — fica como pré-requisito documentado para uma
  spec futura, incluindo entitlements de rede local do macOS.
- Suporte a IPv6 na lista de IPs exibida.
- Changesets ou outra automação de versionamento — decisão explícita por
  `pnpm publish -r` simples, dado que há um único mantenedor hoje.

## Riscos e dependências

- **Pré-requisito:** o repositório não tem nenhum commit ainda. Antes de
  preencher `repository`/`homepage`/`bugs` nos manifestos, precisa existir
  um commit inicial e (idealmente) um remote no GitHub — o nome final do
  repositório entra em três READMEs, dois manifestos e a LICENSE.
- Depende da spec 0002 (autodetecção de host) para o snippet mostrado na
  tela de conexão fazer sentido — sem ela, o snippet ainda seria útil
  (mostra o IP certo), mas o dev precisaria passar `host` sempre.
- `adb reverse` automático via spawn de processo Rust: mitigado com
  caminho absoluto, sem shell, timeout com kill, validação de serial — ver
  detalhes técnicos no plano de implementação, não repetidos aqui.
- macOS pode pedir permissão de firewall no primeiro bind de rede — se
  negada, device físico não conecta mesmo com IP certo; documentado no
  README e na própria tela.

## Métrica de sucesso

Depois de publicado: `npm install spyglass-react` num projeto limpo (fora
deste monorepo) instala e `init()` funciona sem erro — validado manualmente
via `pnpm pack` + instalação num diretório temporário antes do publish real.
E: um dev abrindo o desktop pela primeira vez sem app conectado consegue
copiar um snippet funcional sem sair da tela.

## Plano de teste

- **Automatizado:**
  - `version.test.ts` (vitest, sdk) — `SDK_VERSION` bate com
    `package.json`.
  - Testes Rust puros (sem spawn): parser de `adb devices` (vazio, um
    device, `offline`/`unauthorized`, ruído de daemon), `is_valid_serial`
    rejeitando entrada maliciosa, filtro de interfaces de LAN descartando
    loopback/`169.254.*`/`utun*`/`awdl*`.
- **Manual/ao vivo:**
  1. `pnpm pack` nos dois pacotes + inspeção do tarball (CA1, CA2).
  2. Instalar o tarball (`npm install /path/to/tarball.tgz`) num projeto
     escaffoldado à parte e confirmar `import { init }` funciona (CA3).
  3. Abrir `pnpm dev:desktop` sem nenhum app conectado — conferir IPs
     reais contra `ifconfig | grep "inet "` (CA4).
  4. Conectar um Android real via USB com `adb` disponível — conferir
     status `adb reverse applied` na tela (CA5).
  5. Rodar `adb reverse --remove-all` manualmente com o desktop aberto —
     conferir reaplicação em até 10s (CA6).
  6. Renomear/remover `adb` do PATH e dos caminhos padrão — conferir
     mensagem clara de "não encontrado" (CA7).
