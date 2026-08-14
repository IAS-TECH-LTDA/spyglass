import type { Translations } from "./index";

/**
 * Portuguese strings. Typed as `Translations` — the shape derived from
 * `en.ts`'s keys — so a key missing here (or renamed only in one file) is a
 * `pnpm typecheck` error, never a silent fallback to English at runtime.
 */
export const pt = {
  // ---------------------------------------------------------------------
  // common
  // ---------------------------------------------------------------------
  "common.copy": "Copiar",
  "common.copyFailed": "Falha ao copiar",
  "common.close": "Fechar",
  "common.save": "Salvar",
  "common.cancel": "Cancelar",
  "common.retry": "Tentar novamente",
  "common.retrying": "Tentando novamente…",
  "common.dismiss": "Dispensar",
  "common.refresh": "Atualizar",
  "common.moreCount": "+{count} mais",
  "common.copyValue": "Copiar valor",

  // ---------------------------------------------------------------------
  // app shell (App.tsx)
  // ---------------------------------------------------------------------
  "app.brand": "Spyglass",
  "app.waitingForApp": "Aguardando um app…",
  "app.removeFromList": "Remover da lista",
  "app.removeAppAria": "Remover {name}",
  "app.tabs.navigation": "Navegação",
  "app.tabs.state": "Estado",
  "app.tabs.storage": "Armazenamento",
  "app.tabs.queries": "Queries",
  "app.tabs.console": "Console",
  "app.tabs.network": "Rede",
  "app.tabs.performance": "Performance",

  // ---------------------------------------------------------------------
  // settings popover (components/SettingsPanel.tsx, formerly AlertSettingsPanel)
  // ---------------------------------------------------------------------
  "settings.title": "Configurações",
  "settings.language": "Idioma",
  "settings.language.english": "English",
  "settings.language.portuguese": "Português",
  "settings.alerts": "Alertas",
  "settings.alerts.on": "Alertas ativos",
  "settings.alerts.muted": "Silenciado",
  "settings.triggerOn": "Disparar em",
  "settings.level.error": "Erro",
  "settings.level.warn": "Aviso",
  "settings.networkFailures": "Falhas de rede",
  "settings.notifyWith": "Notificar com",
  "settings.sound": "Som",
  "settings.macNotification": "Notificação do macOS",
  "settings.notificationBlocked": "Bloqueado em Ajustes do Sistema › Notificações › Spyglass.",
  "settings.tryAgain": "Tentar novamente",
  "settings.apps": "Apps",
  "settings.noAppsYet": "Nenhum app conectado ainda.",

  // ---------------------------------------------------------------------
  // connect (views/connect/ConnectView.tsx)
  // ---------------------------------------------------------------------
  "connect.scenario.device": "Dispositivo físico",
  "connect.scenario.iosSimulator": "iOS Simulator",
  "connect.scenario.androidEmulator": "Emulador Android",
  "connect.title": "Nenhum app conectado ainda",
  "connect.subtitle": "O Spyglass está escutando em {url}. Adicione o SDK ao seu app e ele aparece aqui.",
  "connect.step1Title": "Instalar o SDK",
  "connect.step2Title": "Escolha seu cenário",
  "connect.step3Title": "Chame {init} — geralmente no topo de {file}",
  "connect.step4Title": "Anexar um adaptador de estado (opcional)",
  "connect.note.iosSimulator": "Compartilha a rede deste Mac — o SDK detecta “localhost” automaticamente.",
  "connect.note.androidEmulator": "Detectado automaticamente. O Spyglass mantém “adb reverse tcp:8098 tcp:8098” aplicado para você (status abaixo); sem adb, o SDK usa “10.0.2.2” como alternativa.",
  "connect.note.device": "Mesmo Wi-Fi deste Mac. O SDK normalmente detecta isso pela URL do Metro — passe “host” só se não detectar.",
  "connect.lanAddresses": "Endereços LAN desta máquina",
  "connect.refreshLanAria": "Atualizar endereços LAN",
  "connect.noLanAddress": "Nenhum endereço LAN encontrado — esta máquina está no Wi-Fi?",
  "connect.primary": "principal",
  "connect.adaptersNote": "Navegação, storage (AsyncStorage, MMKV, SQLite, Realm, WatermelonDB) e React Query têm seus próprios adaptadores — veja o README do SDK.",
  "connect.listeningOn": "Escutando em {url}",
  "connect.adb.checking": "Procurando adb…",
  "connect.adb.applied": "adb reverse aplicado · {devices}",
  "connect.adb.partial": "adb reverse aplicado a {ok} de {total} dispositivos — {detail}",
  "connect.adb.noDevices": "adb encontrado, nenhum dispositivo conectado — inicia automaticamente assim que um conectar",
  "connect.adb.notFound": "adb não encontrado",
  "connect.adb.error": "erro no adb",

  // ---------------------------------------------------------------------
  // memory (components/memory/MemoryPanel.tsx)
  // ---------------------------------------------------------------------
  "memory.title": "Memória",
  "memory.notAvailable": "Monitoramento de memória ainda não está disponível para esta plataforma.",
  "memory.clearCaches.notice": "\"Limpar caches do app\" roda o coletor de lixo e limpa caches de imagem no app conectado agora.",
  "memory.clearCaches.button": "Limpar caches do app",
  "memory.clearCaches.tooltip": "Roda o coletor de lixo do motor JS e, se o app usa expo-image, limpa o cache de imagens dele. Não é possível liberar memória do sistema como um todo — nenhum app de terceiros pode pedir isso ao SO.",
  "memory.device": "Dispositivo",
  "memory.selectDevice": "Selecione um dispositivo…",
  "memory.package": "Pacote",
  "memory.selectPackage": "Selecione um pacote…",
  "memory.useSuggested": "Usar sugerido: {package}",
  "memory.deviceTotal": "Total do dispositivo",
  "memory.deviceAvailable": "Disponível no dispositivo",
  "memory.appPhysical": "App (física)",
  "memory.appSwap": "Swap do app",
  "memory.simulator": "Simulator",
  "memory.selectSimulator": "Selecione um Simulator em execução…",
  "memory.appBundleLabel": "Nome do bundle do app (ex.: \"MyApp\" para MyApp.app)",
  "memory.simulatorMacOnly": "Memória do Simulator precisa do app desktop rodando no macOS.",
  "memory.noSimulator": "Nenhum Simulator em execução encontrado.",
  "memory.waitingForSimApp": "Aguardando o app aparecer neste Simulator…",
  "memory.appPhysFootprint": "App (phys_footprint)",
  "memory.physicalNote": "Rodando em um iPhone/iPad físico? Ainda não suportado — veja a spec 0008 para entender o motivo (não existe API pública leve para isso).",

  // ---------------------------------------------------------------------
  // network (views/network/NetworkView.tsx)
  // ---------------------------------------------------------------------
  "network.filterPlaceholder": "Filtrar por URL, método ou status…",
  "network.requestCount_one": "{count} requisição",
  "network.requestCount_other": "{count} requisições",
  "network.clearAllAria": "Limpar todas as requisições",
  "network.emptyState": "Nenhuma atividade de rede ainda. Anexe {call} de {module}.",
  "network.noMatches": "Nenhum resultado.",
  "network.resizeListAria": "Redimensionar lista de requisições",
  "network.status": "Status",
  "network.method": "Método",
  "network.duration": "Duração",
  "network.started": "Iniciada",
  "network.copyAsCurl": "Copiar como cURL",
  "network.related": "Relacionado",
  "network.relatedQuery": "Query: {preview}",
  "network.relatedStorage": "Storage: {key} ({engine})",
  "network.request": "Requisição",
  "network.response": "Resposta",
  "network.copyBody": "Copiar corpo de {title}",

  // ---------------------------------------------------------------------
  // queries (views/queries/QueriesView.tsx)
  // ---------------------------------------------------------------------
  "queries.command.refetch": "Refetch",
  "queries.command.invalidate": "Invalidar",
  "queries.command.reset": "Reset",
  "queries.command.remove": "Remover",
  "queries.emptyState": "Nenhum cache de query conectado ainda. Anexe {call} de {module}.",
  "queries.status": "Status",
  "queries.fetchStatus": "Status da busca",
  "queries.observers": "Observadores",
  "queries.dataUpdated": "Dados atualizados",
  "queries.invalidated": "Invalidada",
  "queries.invalidatedYes": "sim — refetch pendente",
  "queries.copyQueryKey": "Copiar chave da query",
  "queries.editBanner": "Editar os dados aqui, ou usar Refetch/Invalidar/Reset/Remover, afeta imediatamente o cache do React Query no app conectado.",
  "queries.data": "Dados",
  "queries.copyData": "Copiar dados",
  "queries.noDataYet": "Nenhum dado ainda.",
  "queries.error": "Erro",
  "queries.removeObserversTooltip": "Esta query tem {count} observador(es) ativo(s) — ela pode reaparecer imediatamente via refetch automático deles.",

  // ---------------------------------------------------------------------
  // storage (views/storage/StorageView.tsx)
  // ---------------------------------------------------------------------
  "storage.emptyState": "Nenhum engine de storage conectado ainda. Anexe um adaptador de storage, ex.: {call} de {module}.",
  "storage.empty": "Vazio.",
  "storage.editBanner": "Editar um valor aqui grava imediatamente na storage do app conectado.",
  "storage.key": "Chave",
  "storage.value": "Valor",
  "storage.editRawJson": "Editar JSON bruto",
  "storage.invalidJson": "JSON inválido",
  "storage.rowsCount": "{count} linhas",
  "storage.noRows": "Nenhuma linha.",
  "storage.resizeDetailAria": "Redimensionar painel de detalhes",
  "storage.goToAria": "Ir para {table}.id = {id}",
  "storage.location.label": "Caminho",
  "storage.location.copyAria": "Copiar caminho",
  "storage.location.configuredNote": "informado pelo app, não lido do engine",
  "storage.clear.engineButton": "Limpar",
  "storage.clear.tableButton": "Limpar tabela",
  "storage.clear.unsupported": "Limpeza não é suportada para este engine/tabela.",
  "storage.clear.confirmTitle": "Limpar {target}?",
  "storage.clear.confirmBody": "Isso apaga permanentemente todos os dados de {target} no app conectado. Não pode ser desfeito.",
  "storage.clear.confirmPrompt": "Digite {target} para confirmar.",
  "storage.clear.confirmButton": "Excluir permanentemente",
  "storage.clear.cancelButton": "Cancelar",

  // ---------------------------------------------------------------------
  // graph (views/graph/GraphView.tsx)
  // ---------------------------------------------------------------------
  "graph.emptyState": "Nenhum evento de navegação ainda. Chame {call} de {module} e navegue até uma tela no app.",
  "graph.screenCount_one": "{count} tela",
  "graph.screenCount_other": "{count} telas",
  "graph.linkCount_one": "{count} link",
  "graph.linkCount_other": "{count} links",
  "graph.clearAria": "Limpar grafo de navegação",
  "graph.resizeDetailAria": "Redimensionar painel de detalhes",
  "graph.visitCount_one": "{count} visita",
  "graph.visitCount_other": "{count} visitas",
  "graph.lastSeen": "Visto por último {time}",
  "graph.noParams": "Sem params.",
  "graph.history": "Histórico",
  "graph.noTransitionsYet": "Nenhuma transição ainda.",
  "graph.start": "(início)",
  "graph.selectScreen": "Selecione uma tela para ver seus params e histórico.",
  "graph.noParamsSummary": "sem params",

  // ---------------------------------------------------------------------
  // stores (views/stores/StoresView.tsx)
  // ---------------------------------------------------------------------
  "stores.emptyState": "Nenhum store de estado conectado ainda. Anexe um adaptador de estado, ex.: {call} de {module}.",
  "stores.actions": "Ações ({count})",
  "stores.changeCount_one": "{count} mudança",
  "stores.changeCount_other": "{count} mudanças",
  "stores.noActionsYet": "Nenhuma ação ainda.",
  "stores.state": "Estado",
  "stores.copyState": "Copiar estado",
  "stores.editBanner": "Editar um campo aqui grava imediatamente no store do app conectado (merge raso, não substitui o store inteiro).",

  // ---------------------------------------------------------------------
  // performance (views/performance/PerformanceView.tsx)
  // ---------------------------------------------------------------------
  "performance.sampleCount_one": "{count} amostra",
  "performance.sampleCount_other": "{count} amostras",
  "performance.stallCount_one": "{count} travamento",
  "performance.stallCount_other": "{count} travamentos",
  "performance.clearAria": "Limpar dados de performance",
  "performance.waitingFirstSample": "Aguardando a primeira amostra…",
  "performance.emptyState": "Nenhum dado de performance ainda. Anexe {call} de {module}.",
  "performance.stalls": "Travamentos",
  "performance.noStalls": "Nenhum travamento registrado — a thread JS não bloqueou por mais tempo que o limite do adaptador.",
  "performance.fps": "fps",

  // ---------------------------------------------------------------------
  // logs (views/logs/LogsView.tsx)
  // ---------------------------------------------------------------------
  "logs.searchPlaceholder": "Buscar nos logs…",
  "logs.clearAllAria": "Limpar todos os logs",
  "logs.emptyState": "Nenhuma saída de console ainda. Anexe {call} de {module}.",
  "logs.noMatches": "Nenhum resultado.",
  "logs.copyLine": "Copiar linha de log",

  // ---------------------------------------------------------------------
  // update banner (components/UpdateBanner.tsx)
  // ---------------------------------------------------------------------
  "update.available": "Spyglass {version} está disponível",
  "update.updateBtn": "Atualizar",
  "update.later": "Mais tarde",
  "update.downloading": "Baixando Spyglass {version}…",
  "update.ready": "Spyglass {version} está pronto — reinicie para concluir a atualização.",
  "update.restartNow": "Reiniciar agora",
  "update.error": "Não foi possível instalar a atualização do Spyglass {version}.",
  "update.tryAgain": "Tentar novamente",
  "update.dismiss": "Dispensar",

  // ---------------------------------------------------------------------
  // JsonGraph family (components/jsonGraph/*)
  // ---------------------------------------------------------------------
  "jsonInspector.root": "(raiz)",
  "jsonInspector.fields": "Campos",
  "jsonInspector.field": "Campo",
  "jsonInspector.value": "Valor",
  "jsonInspector.circularRef": "Referência circular — {label} aponta de volta para um ancestral, nada para mostrar aqui.",
  "jsonInspector.thisNode": "este nó",
  "jsonValueNode.failedToApply": "Falha ao aplicar — veja a coluna de inspeção para detalhes",
  "jsonGraph.largePayload": "Payload grande — mostrando visão em árvore em vez de diagrama.",
  "jsonGraph.itemCount_one": "[…] {count} item",
  "jsonGraph.itemCount_other": "[…] {count} itens",
  "jsonGraph.keyCount_one": "{…} {count} chave",
  "jsonGraph.keyCount_other": "{…} {count} chaves",

  // ---------------------------------------------------------------------
  // JsonTree (components/JsonTree.tsx)
  // ---------------------------------------------------------------------
  "jsonTree.circular": "[Circular]",
  "jsonTree.anonymous": "anônimo",
  "jsonTree.more": " mais",
  "jsonTree.less": " menos",

  // ---------------------------------------------------------------------
  // error boundary (components/ErrorBoundary.tsx)
  // ---------------------------------------------------------------------
  "errorBoundary.title": "Algo deu errado",
  "errorBoundary.body": "Um app conectado enviou dados que o Spyglass não conseguiu renderizar. Isso geralmente é recuperável — recarregue a janela para continuar.",
  "errorBoundary.reload": "Recarregar",

  // ---------------------------------------------------------------------
  // live-edit banner (components/LiveEditBanner.tsx)
  // ---------------------------------------------------------------------
  "liveEditBanner.dismissAria": "Dispensar aviso",

  // ---------------------------------------------------------------------
  // native alert notifications (lib/alerts.ts)
  // ---------------------------------------------------------------------
  "alerts.logTitle": "{app} · {level}",
  "alerts.networkTitle": "{app} · erro de rede",
  "alerts.requestFailed": "requisição falhou",
  "alerts.moreSinceLast": "+{count} mais desde o último alerta",

  // ---------------------------------------------------------------------
  // connection store errors (state/connection.ts)
  // ---------------------------------------------------------------------
  "connection.appDisconnected": "App desconectado",
  "connection.truncatedValue": "Este valor contém dados que foram truncados para exibição (grande/profundo/circular demais) — gravá-lo de volta no app não é seguro.",
  "connection.noResponse": "Sem resposta do app (3s). Ele pode ter desconectado, ou as escritas estão desabilitadas nesta build (produção).",
} as const satisfies Translations;
