# ADR-09 — Identificadores gerados no cliente

**Status:**

- [ ] Aceito
- [ ] Recusado

**Justificativa:** é consequência direta do offline e precisa ser decidida antes do schema existir.

**Contexto:** O app cria registros sem rede. Se o identificador vier do servidor, o registro local não tem identidade até sincronizar — e qualquer coisa que aponte para ele (um insumo dentro de um procedimento) fica sem referência.

**Opções:** (a) identificador numérico sequencial do banco; (b) UUID gerado no app; (c) identificador local temporário substituído na sincronização.

**Decisão:** (b) UUID gerado no app.

**Consequências:** (+) o registro nasce com identidade definitiva, online ou offline; (+) push idempotente fica trivial. (−) identificadores ilegíveis em depuração; (−) tem custo de índice e armazenamento, irrelevante neste volume. (−) o servidor passa a receber identificador do cliente, e precisa validar que ele não colide com registro de outro usuário. 🗄️ BANCO — o time de banco precisa saber disso antes de definir chaves.
