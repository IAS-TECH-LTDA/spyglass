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

## Entregue

| Item | Onde | Validado |
|------|------|----------|
| Inferência de FK no diagrama de Storage passa a casar sufixo de nome de tabela (ex.: `gallery_id` → `product_gallery`), além do nome exato já suportado — mantém casos ambíguos (2+ tabelas com o mesmo sufixo) sem linha, de propósito | `apps/desktop/src/views/storage/inferForeignKeys.ts` | 10 testes unitários (`__tests__/inferForeignKeys.test.ts`), incluindo regressão do bug pego ao vivo pelo usuário via hot-reload (falso-positivo entre duas tabelas `_gallery` com a mesma coluna ambígua) |
