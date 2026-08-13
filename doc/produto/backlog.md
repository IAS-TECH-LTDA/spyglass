# Backlog — Spyglass

Escala de **Reach** usada neste backlog (proxy, sem analytics real):
10 = toca toda sessão de todo app instrumentado (todo `hello` enviado
pelo SDK); 5 = só um subconjunto de apps/plataformas; 1 = uso raro,
só administração/debug interno do próprio time.

Ver `references/priorizacao-rice.md` da skill `product-owner` para as
demais dimensões (Impact, Confidence, Effort) e a fórmula de score.

## Backlog (a fazer)

_(nenhum item pendente)_

## Em desenvolvimento

| # | Item | Spec | R | I | C | E | Score | Pendência |
|---|------|------|---|---|---|---|-------|-----------|
| 0001 | Detecção real de framework (Expo / RN bare / ReactJS-web) | [0001-deteccao-framework.md](specs/0001-deteccao-framework.md) | 8 | 2 | 80% | 1.5 | 8.5 | Validação manual ao vivo (CA1–CA3) com apps Expo/RN-bare/web reais |
| 0002 | Autodetecção de host (simulador / emulador / device físico) | [0002-deteccao-host.md](specs/0002-deteccao-host.md) | 9 | 3 | 80% | 3 | 7.2 | Validação manual ao vivo (todos os CAs); depende de app externo ou `examples/rn-playground` |
| 0003 | Preparação para publicação no npm + tela de conexão do desktop | [0003-publicacao-npm.md](specs/0003-publicacao-npm.md) | 6 | 3 | 100% | 2 | 9.0 | Commit inicial + remote do repositório; validação manual do tarball e do publish |
| 0004 | Auto-attach de Console, Network e Performance em dev | [0004-auto-attach-console-network-performance.md](specs/0004-auto-attach-console-network-performance.md) | 9 | 2 | 90% | 1.5 | 10.8 | Validação manual ao vivo (repetir a integração desta sessão num app real) |
| 0005 | Alertas (som, badge in-app, notificação nativa) para erros | [0005-alertas-erro.md](specs/0005-alertas-erro.md) | 8 | 3 | 80% | 4 | 4.8 | Validação manual ao vivo numa máquina real (permissão, notificação em segundo plano, som, rajada, reconexão) |
| 0006 | Visualizador de JSON em diagrama de nós | [0006-visualizador-json-diagrama.md](specs/0006-visualizador-json-diagrama.md) | 9 | 2 | 90% | 4 | 4.1 | Validação manual ao vivo nas 8 telas trocadas, incluindo payload grande (fallback) e canvas embutido em painel |
| 0007 | Escrita ao vivo em Storage KV a partir do desktop | [0007-escrita-storage-desktop.md](specs/0007-escrita-storage-desktop.md) | 5 | 2 | 70% | 5 | 1.4 | Depende da 0006; validação manual ao vivo com AsyncStorage/MMKV/web-storage reais, incluindo desconexão em pleno write |
| 0008 | Monitoramento de memória/armazenamento/swap do device e do app + limpar caches | [0008-monitoramento-memoria-dispositivo.md](specs/0008-monitoramento-memoria-dispositivo.md) | 5 | 2 | 80% | 6 | 1.3 | Validação manual ao vivo em device Android real + Simulator iOS; sem suporte a device físico iOS (ver Fora de escopo) |
| 0009 | Auto-update do desktop via GitHub Releases | [0009-auto-update-desktop.md](specs/0009-auto-update-desktop.md) | 8 | 3 | 90% | 5 | 4.3 | Pré-requisitos manuais (criar o repo no GitHub, gerar as chaves minisign, secrets Apple/updater), primeiro release real e teste em máquina limpa (CA6–CA8) |
| 0010 | Escrita e controle ao vivo de Queries (React Query) | [0010-escrita-controle-queries.md](specs/0010-escrita-controle-queries.md) | 5 | 2 | 75% | 4 | 1.9 | Depende de release novo do SDK publicado; validação manual ao vivo com um app RN real (edição, os 4 comandos, caso do `queryKey` com `Date`) |
| 0011 | Destaque em telas editáveis + correlação Network↔Queries/Storage | [0011-destaque-edicao-e-correlacao-network.md](specs/0011-destaque-edicao-e-correlacao-network.md) | 7 | 2 | 85% | 3 | 4.0 | Validação manual ao vivo (banner/destaque nas 4 telas, navegação pelos chips "Related", caso de ambiguidade proposital) |

## Entregue

| Item | Onde | Validado |
|------|------|----------|
| Inferência de FK no diagrama de Storage passa a casar sufixo de nome de tabela (ex.: `gallery_id` → `product_gallery`), além do nome exato já suportado — mantém casos ambíguos (2+ tabelas com o mesmo sufixo) sem linha, de propósito | `apps/desktop/src/views/storage/inferForeignKeys.ts` | 10 testes unitários (`__tests__/inferForeignKeys.test.ts`), incluindo regressão do bug pego ao vivo pelo usuário via hot-reload (falso-positivo entre duas tabelas `_gallery` com a mesma coluna ambígua) |
