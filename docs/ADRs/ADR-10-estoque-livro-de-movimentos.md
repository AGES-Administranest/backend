# ADR-10 — Estoque como livro de movimentos, não como saldo mutável

**Status:**

- [x] Aceito
- [ ] Recusado

**Justificativa:** a baixa automática ao registrar em serviço + offline torna o contador inseguro. 🗄️ BANCO

**Contexto:** Registrar insumo em procedimento dá baixa. Saldo negativo é aceito (indica inventário errado, não consumo impossível).

**Opções:** (a) campo de saldo no item, alterado a cada operação; (b) registros de movimento (entrada/saída), saldo calculado pela soma; (c) híbrido com saldo recalculado periodicamente.

**Decisão:** (b) livro de movimentos. Um contador mutável sob "último a escrever vence" é perigoso: se dois lotes de sincronização chegarem com saldos diferentes, um sobrescreve o outro e o consumo simplesmente desaparece. Movimentos são somente inserção — não têm conflito.

**Consequências:** (+) sincronização sem conflito na área mais acoplada do sistema; (+) histórico auditável. (−) saldo exige soma, e alguém vai achar isso "lento" — não é, no volume de vocês; (−) mais registros; (−) exige disciplina: ninguém edita movimento, corrige-se com outro movimento. (c) é otimização de escala e não deve ser feita aqui.

**Vínculo procedimento↔insumo:** o consumo de um insumo num procedimento é apenas mais um registro em `stock_movement`, com `source = APPOINTMENT` e `appointment_id` preenchido — não existe (nem é necessário) um model separado do tipo `AppointmentItem`. Os insumos de um procedimento são obtidos com `SELECT * FROM stock_movement WHERE appointment_id = :id AND source = 'APPOINTMENT'`, já coberto pelo índice em `appointment_id`.

Alternativa considerada e recusada: um model `AppointmentItem` à parte, para itens "avulsos" sem controle de estoque. Recusada porque hoje todo insumo usado num procedimento corresponde a um `Item` cadastrado — não há caso de uso de item avulso sem lastro em estoque. Se esse caso surgir no futuro, a resposta é um model novo dedicado a itens avulsos, e não uma flag em `stock_movement`: misturar "baixa real de estoque" com "registro informativo sem baixa" no mesmo ledger quebraria a garantia de que todo `stock_movement` representa uma movimentação real (base do cálculo de saldo por soma).
