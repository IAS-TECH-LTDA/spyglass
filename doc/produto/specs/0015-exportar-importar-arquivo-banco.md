# 0015 — Exportar/importar o arquivo de banco de dados

- **Status:** em desenvolvimento
- **RICE:** R 3 · I 3 · C 50% · E 8 → **score 0.6**
- **Criada em:** 2026-08-14

## Contexto e problema

Tirar o `.db`/`.realm` real de um dispositivo hoje é um ritual manual de
`adb exec-out run-as <pkg> cat <path> > local.db` (Android) ou vasculhar o
container do Simulator (iOS) — nada disso está na interface do Spyglass.
Depende diretamente da spec 0013: sem `StorageLocation.path` confiável não
há o que puxar. O desktop também não tinha nenhuma capacidade de
filesystem antes desta spec (sem `tauri-plugin-fs`/`-dialog`, sem permissão
em `capabilities/default.json`).

Decisão de escopo (com o usuário): exportar o **arquivo binário real**, não
um dump JSON — o resultado abre direto no DB Browser/Realm Studio.

## Personas / usuários afetados

- **Dev querendo inspecionar o banco fora do Spyglass** — quer o arquivo
  real num app dedicado (DB Browser for SQLite, Realm Studio).
- **Dev querendo reproduzir um bug com um banco específico** — quer
  importar um `.db` de volta no dispositivo/simulador para reproduzir um
  estado exato.

## Histórias de usuário

Como dev com SQLite ou Realm conectado (Android debuggable ou iOS
Simulator), quero exportar o arquivo de banco real para uma pasta no meu
Mac, para abrir num visualizador dedicado.

Como dev com um `.db` de referência, quero importá-lo de volta no
dispositivo/simulador, para reproduzir um estado específico sem recriar os
dados manualmente.

Como dev, quero saber claramente quando exportar/importar não é possível
(iOS físico, engines não-relacionais), em vez de um botão que sempre
aparece e às vezes falha sem explicação.

## Critérios de aceite

- [x] **CA1** — Dado um app Android debuggable com SQLite/Realm conectado
      e device/package já escolhidos na aba Performance, Quando o dev
      clica "Export .db" e escolhe uma pasta, Então o arquivo principal (e
      `-wal`/`-shm` quando existirem) é copiado via `adb exec-out run-as
      ... cat` para a pasta escolhida.
- [x] **CA2** — Dado o mesmo cenário, Quando uma escrita recente ainda só
      existe no `-wal` (SQLite em modo WAL), Então o export inclui o
      `-wal`/`-shm` — abrir o `.db` exportado no DB Browser mostra o dado
      escrito segundos antes, não uma versão desatualizada.
- [x] **CA3** — Dado um app rodando no iOS Simulator (path reportado
      contém `CoreSimulator`), Quando o dev exporta, Então é uma cópia de
      arquivo direta (sem `adb`/`simctl`), já que o path do SDK já é um
      caminho real neste Mac.
- [x] **CA4** — Dado um app num iPhone/iPad físico, Quando o dev olha a
      aba Storage, Então o botão de exportar/importar aparece desabilitado
      com o motivo visível ("não disponível para dispositivo físico") — não
      escondido, não tentando e falhando.
- [x] **CA5** — Dado um `.db` local escolhido para importar, Quando o dev
      confirma (modal de confirmação, sem digitação — a escolha do arquivo
      pelo seletor nativo já é o gesto deliberado), Então o arquivo (e
      `-wal`/`-shm` locais correspondentes) substitui o arquivo no
      dispositivo, e um `-wal`/`-shm` órfão no destino é removido se o
      arquivo importado não tiver um correspondente local.
- [x] **CA6** — Dado um import concluído, Quando a UI confirma sucesso,
      Então ela avisa explicitamente que o app precisa ser reiniciado —
      o banco já está aberto pelo app, sobrescrever o arquivo por baixo
      não afeta a conexão viva.
- [x] **CA7** — Dado AsyncStorage/MMKV/web Storage (engines KV, sem um
      arquivo único de banco), Quando o dev olha a aba Storage, Então
      nenhum botão de exportar/importar é mostrado ali.

## Checklist de impacto

- **Autenticação / autorização:** n/a — ação local do desktop sobre um
  dispositivo já conectado por USB/localhost, mesma superfície de
  confiança do `adb`/Simulator já usados pela spec 0008.
- **Isolamento de dados:** o comando Rust nunca aceita um `device_path`
  arbitrário sem contexto — vem sempre de `StorageLocation.path` que o SDK
  do próprio app reportou.
- **Limites / cotas / billing:** n/a.
- **Auditoria / rastreabilidade:** n/a.
- **Dados pessoais / privacidade:** o arquivo exportado é uma cópia local
  no Mac do próprio dev, de um app que ele já está debugando — mesma
  categoria de acesso que o resto da inspeção de Storage já tem.
- **Notificações / comunicação externa:** n/a.
- **Interface / experiência:** botões "Export .db"/"Import .db" na aba
  Storage de engines relacionais; estado de progresso (exportar/importar
  não é instantâneo para um banco grande); mensagem de erro visível;
  matriz de suporte explícita por plataforma (Android debuggable e iOS
  Simulator sim; iOS físico e engines KV não, com o motivo).
- **Migração de dados / schema:** n/a — não muda o protocolo SDK↔Desktop,
  só adiciona comandos Tauri novos (`export_db_file_android`,
  `import_db_file_android`, `export_db_file_ios_simulator`,
  `import_db_file_ios_simulator`) e o plugin `tauri-plugin-dialog` para o
  seletor de arquivo/pasta nativo.
- **Compatibilidade / integração externa:** novo módulo Rust
  `src-tauri/src/db_file.rs`; nova permissão `dialog:default` em
  `capabilities/default.json`; nova dependência `tauri-plugin-dialog`
  (Rust) e `@tauri-apps/plugin-dialog` (frontend).
- **Performance / escala:** timeout de transferência de arquivo (60s,
  maior que o timeout padrão de comandos `adb` de 10s) — um banco de
  dezenas de MB pode legitimamente levar mais tempo que uma chamada
  `dumpsys`.

## Fora de escopo

- Dump JSON como alternativa ao arquivo binário — decisão explícita do
  usuário pelo arquivo real.
- Exportar/importar de um iPhone/iPad físico — não existe equivalente de
  `run-as` para alcançar o container privado do app a partir do desktop.
- Recarregar o banco no app sem reiniciá-lo — reabrir a conexão do
  SQLite/Realm de dentro do app é uma feature separada, deliberadamente
  fora de escopo (CA6 apenas avisa que o restart é necessário).
- Limpar uma coleção específica do WatermelonDB via este canal — só
  export/import do arquivo `.db` subjacente ao SQLiteAdapter, quando o dev
  informar o `path` (spec 0013).

## Riscos e dependências

- **Depende inteiramente da spec 0013** — sem `location.path`, o botão
  simplesmente não aparece (mesmo padrão de "não oferecer controle que só
  pode falhar" das specs anteriores).
- **Heurística de detecção do iOS Simulator**: não há campo em `AppInfo`
  que diga "isto é Simulator, não device físico" — a detecção usa o fato
  de que todo path de container do Simulator contém `CoreSimulator`
  (convenção da Apple). Uma detecção errada só faz o botão não aparecer
  (fail-closed), nunca tentar uma operação que vai falhar.
- **Identidade Android (serial/package) reaproveitada da spec 0008**: as
  chaves `dm:memory-android-serial:{appId}`/`dm:memory-android-package:{appId}`
  já persistidas pelo `MemoryPanel` são lidas diretamente — se o dev nunca
  abriu a aba Performance para este app, a mensagem de erro pede
  explicitamente para abri-la uma vez; não há um segundo seletor
  duplicado nesta spec.
- **`adb push` não escreve direto no diretório privado do app** — daí o
  padrão push-para-tmp-mundial-legível + `run-as cp` + limpeza do tmp, o
  mesmo truque que o `run-as cat` do export evita ter que replicar ao
  contrário.

## Métrica de sucesso

Um dev exporta o `.db` real de um app Android/iOS Simulator conectado e
consegue abri-lo imediatamente num visualizador de banco de terceiros, com
os dados mais recentes (incluindo o que só estava no WAL) — sem rodar
nenhum comando `adb` manualmente.

## Plano de teste

- **Automatizado:**
  - `apps/desktop/src-tauri/src/db_file.rs` (`cargo test`) —
    `file_name_of` extrai o basename e rejeita um path sem nome de
    arquivo; sufixos `-wal`/`-shm` são apensados diretamente após o nome
    completo do arquivo (CA2's convenção); `export_db_file_android`/
    `import_db_file_android` rejeitam serial/package inválidos antes de
    tocar em `adb`; `export_db_file_ios_simulator` copia o arquivo
    principal e um sibling presente, pulando um sibling ausente sem erro
    (CA2 no caminho do Simulator); `import_db_file_ios_simulator` remove
    um `-wal` órfão no destino quando não há `-wal` local correspondente
    (CA5).
- **Manual/ao vivo:**
  1. Exportar de um Android debuggable real e abrir o `.db` no DB
     Browser — conferir que uma escrita feita segundos antes aparece
     (CA1, CA2).
  2. Repetir no iOS Simulator (CA3).
  3. Importar o arquivo de volta, reiniciar o app conectado e conferir os
     dados (CA5, CA6).
  4. Conectar um app num iPhone físico — confirmar que o botão aparece
     desabilitado com o motivo (CA4).
  5. Conferir que AsyncStorage/MMKV não mostram os botões de
     exportar/importar (CA7).
  6. Sem nunca ter aberto a aba Performance para este app, clicar
     Exportar num Android — confirmar a mensagem pedindo para abrir
     Performance primeiro, em vez de uma falha silenciosa.
