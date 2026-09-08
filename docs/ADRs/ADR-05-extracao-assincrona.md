# ADR-05 — Extração de dados de arquivo: síncrona vs. assíncrona

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** Aplica-se à NFS-e e ao espelho de pedido de compra. Você confirmou que a técnica de extração ainda está em pesquisa e que a operação é bloqueada quando offline.

**Opções:** (a) extrair na própria requisição de upload; (b) assíncrono com status (PENDENTE / PROCESSADO / FALHOU) e o app consultando depois; (c) não extrair — digitação manual com o arquivo apenas anexado.

**Decisão:** (b) assíncrono com status, não puramente por performance: a extração pode falhar com frequência e um modelo de status transforma a falha em estado normal do sistema em vez de erro de requisição. Controle simples em tabela no banco de dados, sem REDIS nem fila com RabbitMQ nem nada do tipo.

**Consequências:** (+) falha vira status revisável, não erro; (−) mais estados na interface; (−) se o processo do Node reiniciar no meio, o job fica preso em PROCESSANDO — precisa de reprocessamento manual, e isso é aceitável aqui. (Daria para contornar com coluna started_at e limite de tempo da extração, mas não é prioridade.)

**Recomendação de escopo feita pelo claude, e eu considero OK:** Entregar tela simples com digitação das infos antes para validação de fluxo E2E, e depois adicionar extração automática.
