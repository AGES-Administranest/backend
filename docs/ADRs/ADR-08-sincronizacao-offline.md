# ADR-08 — Modelo de sincronização offline

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** O app deve permitir leitura e escrita sem rede. Resolução de conflito por 'último a escrever vence', por registro (não por coluna). Operações que dependem de arquivo ficam bloqueadas offline.

**Opções:** (a) sincronização por entidade, cada módulo com seu endpoint; (b) endpoint único de push/pull em lote, com cursor;

**Decisão:** (b) endpoint único em um módulo sync. O app envia um lote de registros criados/alterados desde a última sincronização e recebe tudo que mudou no servidor desde a última atualização. (a) obrigaria o app a orquestrar dezenas de chamadas e a lidar com sincronização parcial.

**Consequências:** (+) um lugar só para a lógica mais difícil do sistema; (+) o app tem um único ponto de falha para tratar. (−) o sync conhece todos os módulos — é a exceção admitida à regra de fronteiras; (−) vira gargalo de time: uma pessoa experiente deve ser dona dele; (−) todo módulo novo precisa se registrar no sync, o que é fácil de esquecer.

**Três armadilhas para registrar desde já:** o relógio do celular pode estar errado e quebrar o "último vence" (mitigação: descartar registros com data futura absurda); o cursor por horário pode pular registros gravados em transações concorrentes (mitigação barata: reler alguns segundos a mais e o app aplicar de forma idempotente); e o push precisa ser idempotente, porque a rede vai cair no meio e o app vai reenviar.

---

## Exceção registrada — estoque (US "Sincronização offline das movimentações")

A sincronização das movimentações de estoque foi implementada como **opção (a)**,
com rotas no próprio módulo (`GET`/`POST /stock-movement/sync`), e não pelo
endpoint único que esta decisão escolheu. Fica registrado para que a divergência
seja deliberada e visível, em vez de virar precedente silencioso.

**Por quê:** a task da US definiu esse contrato explicitamente e foi reafirmada
depois que o conflito com este ADR foi levantado. O módulo `sync` que a opção (b)
prevê não existe, e criá-lo para uma única entidade seria construir o gargalo
antes de haver o que centralizar.

**O que isso custa:** quando a segunda entidade precisar sincronizar, a escolha
volta à mesa — ou o projeto acumula endpoints de sync por módulo, que é
exatamente o que esta decisão queria evitar, ou as rotas de estoque migram para o
módulo único. A segunda opção é barata enquanto só existe uma entidade: a lógica
toda vive em `StockMovementsService.syncPush`/`syncPull`, e as rotas são uma
casca fina por cima.

**O que foi respeitado deste ADR:** as três armadilhas continuam tratadas.
Relógio do aparelho — `occurredAt` no futuro é recusado, com dez minutos de
tolerância para deriva honesta. Cursor por horário — o delta recua alguns
segundos ao devolver o cursor, e o app aplica por id. Push idempotente — o id é
UUID do cliente (ADR-09) e é a chave primária, então reenviar é inofensivo.

