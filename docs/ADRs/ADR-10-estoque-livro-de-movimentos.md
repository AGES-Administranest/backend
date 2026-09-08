# ADR-10 — Estoque como livro de movimentos, não como saldo mutável

**Status:**

- [ ] Aceito
- [ ] Recusado

**Justificativa:** a baixa automática ao registrar em serviço + offline torna o contador inseguro. 🗄️ BANCO

**Contexto:** Registrar insumo em procedimento dá baixa. Saldo negativo é aceito (indica inventário errado, não consumo impossível).

**Opções:** (a) campo de saldo no item, alterado a cada operação; (b) registros de movimento (entrada/saída), saldo calculado pela soma; (c) híbrido com saldo recalculado periodicamente.

**Decisão:** (b) livro de movimentos. Um contador mutável sob "último a escrever vence" é perigoso: se dois lotes de sincronização chegarem com saldos diferentes, um sobrescreve o outro e o consumo simplesmente desaparece. Movimentos são somente inserção — não têm conflito.

**Consequências:** (+) sincronização sem conflito na área mais acoplada do sistema; (+) histórico auditável. (−) saldo exige soma, e alguém vai achar isso "lento" — não é, no volume de vocês; (−) mais registros; (−) exige disciplina: ninguém edita movimento, corrige-se com outro movimento. (c) é otimização de escala e não deve ser feita aqui. VALIDAR COM AGES II O SCHEMA DO BANCO.
