# Dicionário de dados

Complemento aos doc-comments (`///`) do `prisma/schema.prisma`. Aqui ficam as
convenções que atravessam mais de uma coluna ou tabela.

## Estoque — `stock_movement`

`stock_movement` é o livro-razão do estoque: **append-only**, uma linha por
evento. `item.current_quantity` e `item_lot.current_quantity` são caches da soma
dessas linhas.

### Convenção de sinal

| Regra | Valor |
|---|---|
| `quantity` | **Sempre positiva.** Nunca `0`, nunca negativa. `NUMERIC(14,3)`. |
| Direção | Vem **exclusivamente** de `type`. |
| `type = INBOUND` | Soma em `current_quantity`. |
| `type = OUTBOUND` | Subtrai de `current_quantity`. |

O cálculo de saldo é sempre:

```sql
SUM(CASE type WHEN 'INBOUND' THEN quantity ELSE -quantity END)
```

Isso vale para **todas** as origens, sem exceção:

- **Ajuste que aumenta o estoque** (ex.: contagem achou mais do que o sistema):
  `type = INBOUND`, `source = MANUAL_ADJUSTMENT`.
- **Ajuste que reduz o estoque** (perda, quebra, vencimento):
  `type = OUTBOUND`, `source = MANUAL_ADJUSTMENT`, `adjustment_reason` preenchido.
- **Estorno** (`source = CORRECTION_REVERSAL`): `type` é o **oposto** do registro
  sendo corrigido, mesma `quantity`. Um estorno de uma entrada é uma saída.

Não existe `adjustment_in` / `adjustment_out` nem coluna de sinal: `type` já
carrega a direção para qualquer movimento. `adjustment_reason` responde só ao
*porquê*, nunca à direção.

### Origem (`source`) × colunas de vínculo

| `source` | Significado | Coluna de vínculo esperada |
|---|---|---|
| `MANUAL_PURCHASE` | Entrada digitada à mão, sem nota fiscal | `supplier_id` (opcional) |
| `ORDER_IMPORT` | Entrada gerada ao receber um pedido de compra | `purchase_order_id` |
| `APPOINTMENT` | Consumo de material em atendimento | `appointment_id` |
| `MANUAL_ADJUSTMENT` | Reconciliação manual de saldo | `adjustment_reason` |
| `CORRECTION_REVERSAL` | Estorno de um lançamento errado | — (referencia o original via `notes`) |

Entrada vinda de OCR de nota fiscal usa `purchase_invoice_line_id` (origem
registrada conforme o fluxo que a criou).

### `adjustment_reason` (`adjustment_reason_enum`)

`LOSS` · `EXPIRATION` · `BREAKAGE` · `OTHER`. Preenchido **apenas** quando
`source = MANUAL_ADJUSTMENT`. `NULL` em qualquer outra origem. Regra de aplicação
— não expressável no Prisma, validar no serviço.

### Correção: `deleted_at` vs `CORRECTION_REVERSAL`

Ver doc-comment do model `StockMovement`. Resumo: `deleted_at` (soft delete) só
para erro pego antes de qualquer efeito; `CORRECTION_REVERSAL` para erro que já
afetou saldo ou já foi visto. Nunca os dois no mesmo registro.

### `item.needs_adjustment`

Booleano persistido, `default false`. Sinalizador da **US10**: liga quando uma
movimentação (tipicamente um `CORRECTION_REVERSAL`) deixa `current_quantity < 0`;
desliga quando o usuário registra o ajuste que reconcilia o saldo. É persistido
porque é estado de workflow — o item continua "a ajustar" mesmo que outra entrada
zere o negativo depois.

## Compras — `purchase_order`

Pedido de compra a um fornecedor. Ao ser recebido (`status = RECEIVED`,
`received_at` preenchido) gera as entradas de estoque correspondentes
(`stock_movement.source = ORDER_IMPORT`). É diferente de `purchase_invoice`, que
é o documento fiscal digitalizado por OCR.

`status` (`purchase_order_status_enum`): `DRAFT` → `PLACED` → `RECEIVED`, ou
`CANCELLED` a partir de `DRAFT`/`PLACED`.
