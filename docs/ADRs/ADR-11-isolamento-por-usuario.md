# ADR-11 — Isolamento por usuário aplicado em um único ponto

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** Não há papéis nem permissões: cada profissional vê apenas o que é seu. Isso significa que toda consulta precisa filtrar por usuário. Basta um findMany sem filtro para vazar dados de outro profissional.

**Opções:** (a) cada dev lembra de filtrar; (b) o Repository de cada módulo recebe o usuário e aplica o filtro sempre;

**Decisão:** (b), com o usuário extraído do token e nunca aceito como parâmetro vindo do app.

**Consequências:** (+) um lugar por módulo para revisar; (+) checklist de code review objetivo. (−) repetitivo; (−) alguém vai criar uma consulta nova esquecendo o filtro. Mitigação obrigatória: um teste automatizado por módulo que cria dados de dois usuários e verifica que um não enxerga o outro. Se vocês só escreverem um tipo de teste no projeto inteiro, que seja esse.
