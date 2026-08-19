# ADR-07 — Padrão de tratamento e formato de erro

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** Devs escrevendo endpoints em paralelo produzem formatos de erro diferentes. O app offline precisa distinguir três coisas: erro do usuário (não adianta tentar de novo), erro temporário (vale tentar de novo depois) e conflito de sincronização.

**Opções:** (a) deixar o NestJS responder o padrão dele; (b) filtro global de exceções com formato único; (c) formato único mais catálogo de códigos de erro.

**Decisão:** (c), e o esforço extra é pequeno. Um filtro global de exceções na pasta compartilhada, um formato único de resposta com código de erro textual e estável (algo como ESTOQUE_ITEM_NAO_ENCONTRADO), isso também serve para alterar o idioma das mensagens, visto que foi comentado que podemos preparar o sistema para mais de um idioma.

**Consequências:** (+) o app trata erro de um jeito só; (+) mensagem pode mudar sem quebrar o app. (−) exige manter uma lista de códigos, que alguém sempre esquece de atualizar. Regra prática: ninguém devolve erro fora do filtro global, e nenhum erro sobe para o app com detalhe interno (stack trace, mensagem crua do Prisma). Erro de validação de DTO segue o mesmo formato dos demais.
