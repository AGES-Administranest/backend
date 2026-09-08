# ADR-02 — Cognito como fonte da verdade vs. entidade de usuário própria

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** O Cognito autentica. Mas todo dado do sistema pertence a um profissional, e a exigência de isolamento por usuário significa que praticamente toda tabela referencia alguém. Além disso, o app é offline: o token do Cognito expira, e ela pode passar horas sem rede.

**Opções:** (a) só Cognito, backend nunca guarda usuário; (b) entidade Usuario local espelhando o Cognito; (c) usuário só no banco, Cognito ignorado.

**Decisão:** (b) espelho local. O Cognito continua sendo a fonte da verdade para credenciais (email, senha, confirmação). O banco guarda um registro local com o identificador estável do Cognito (o sub), mais nome e foto. O espelho é criado no primeiro login válido.

**Consequências:** (+) integridade referencial local; (+) funciona sem chamar a AWS a cada consulta. (−) dois lugares com dados do usuário e risco de divergência; (−) alterar email exige decidir quem manda (recomendação: Cognito manda, o espelho atualiza no login seguinte).

**Ponto crítico offline:** o app precisa abrir e permitir escrita local com token expirado, exigindo token válido apenas para sincronizar. Isso depende do tempo de vida do refresh token do Cognito. Validar tempo de expiração do refresh token antes de fechar o desenho, porque se ele expirar, o app offline não consegue sincronizar.
