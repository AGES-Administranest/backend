# ADR-08 — Modelo de sincronização offline

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** O app deve permitir leitura e escrita sem rede. Resolução de conflito por 'último a escrever vence', por registro (não por coluna). Operações que dependem de arquivo ficam bloqueadas offline.

**Opções:** (a) sincronização por entidade, cada módulo com seu endpoint; (b) endpoint único de push/pull em lote, com cursor;

**Decisão:** (b) endpoint único em um módulo sync. O app envia um lote de registros criados/alterados desde a última sincronização e recebe tudo que mudou no servidor desde a última atualização. (a) obrigaria o app a orquestrar dezenas de chamadas e a lidar com sincronização parcial.

**Consequências:** (+) um lugar só para a lógica mais difícil do sistema; (+) o app tem um único ponto de falha para tratar. (−) o sync conhece todos os módulos — é a exceção admitida à regra de fronteiras; (−) vira gargalo de time: uma pessoa experiente deve ser dona dele; (−) todo módulo novo precisa se registrar no sync, o que é fácil de esquecer.

**Três armadilhas para registrar desde já:** o relógio do celular pode estar errado e quebrar o "último vence" (mitigação: descartar registros com data futura absurda); o cursor por horário pode pular registros gravados em transações concorrentes (mitigação barata: reler alguns segundos a mais e o app aplicar de forma idempotente); e o push precisa ser idempotente, porque a rede vai cair no meio e o app vai reenviar.
