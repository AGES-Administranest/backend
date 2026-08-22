# ADR-12 — Emulação local de Cognito e S3

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** O ADR-02 e o ADR-03 fazem a API depender de Cognito e S3. Sem equivalente local, todo desenvolvimento desses dois fluxos passa por um ambiente remoto: cada pessoa precisa de credenciais da AWS, o estado é compartilhado pelo time inteiro (um apaga o bucket em que o outro está trabalhando) e nada funciona sem rede. O objetivo é que qualquer pessoa clone o repositório e desenvolva autenticação e upload na própria máquina, sem recurso externo e sem credencial pessoal.

**Opções:** (a) um ambiente AWS de desenvolvimento compartilhado pelo time; (b) recursos AWS separados por pessoa; (c) emulador local.

**Decisão:** (c) MiniStack — container único na porta 4566, licença MIT, cobrindo Cognito e S3. A opção (a) dá conflito de estado entre desenvolvedores e exige distribuir credenciais; a (b) multiplica custo e trabalho de administração, e nenhuma das duas funciona sem rede. O Postgres continua sendo o `postgres:16-alpine` do Compose; o RDS do emulador não é usado. A criação dos recursos fica em `scripts/bootstrap-aws.sh`, executado por um container `amazon/aws-cli`, sem instalação local da CLI.

**Comportamento verificado (MiniStack 1.3.66):** os tokens do `AdminInitiateAuth` são RS256 assinados pela chave publicada no JWKS do pool, e token com payload alterado é rejeitado. O guard valida assinatura da mesma forma em local e em produção; não há modo degradado para desenvolvimento.

**Divergências do emulador:** (1) o `iss` do token é `https://cognito-idp.<região>.amazonaws.com/<pool-id>`, não o endereço local — validar issuer contra `localhost` rejeita todo token, e o valor é idêntico nos dois ambientes; (2) o JWKS fica em `/<pool-id>/.well-known/jwks.json`, e a raiz `/.well-known/jwks.json` é tratada como requisição ao S3; (3) a rotação de refresh token não é implementada: o parâmetro `RefreshTokenRotation` é aceito e descartado, `REFRESH_TOKEN_AUTH` continua válido com rotação ligada e `GetTokensFromRefreshToken` não devolve refresh token novo. Código que dependa de rotação passa em local e falha na AWS real.

**Biblioteca de verificação:** `jose`. A `aws-jwt-verify` não é utilizável contra o emulador: o `CognitoJwtVerifier` deriva o `jwks_uri` do pool id e ignora o override, e o `JwtVerifier` genérico recusa URI em `http`. A verificação não depende de SDK da AWS — é conferência de assinatura contra o JWKS mantido em cache.

**Consequências:** (+) Cognito e S3 disponíveis em qualquer máquina com `docker compose up` e um bootstrap, sem credencial real em circulação e sem rede; (+) cada pessoa tem estado próprio, e derrubar o ambiente local não afeta ninguém; (+) o código de autenticação e de upload é o mesmo nos dois ambientes, mudando apenas o `endpoint` do SDK; (−) mais um container e um passo de bootstrap na rotina de quem clona o repositório.

**Fora do escopo:** EC2 (no MiniStack é apenas metadado, sem SSH e sem tráfego) e IaC. Se o time adotar Terraform depois, ele nasce mirando a AWS real, não o emulador.
