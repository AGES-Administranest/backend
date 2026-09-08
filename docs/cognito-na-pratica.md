# Cognito na prática — explorando o emulador na mão

Roteiro para conhecer o Cognito local antes de escrever código: ver o user pool criado, criar um usuário, fazer login e receber a credencial. Todos os comandos e saídas abaixo foram executados de verdade contra o MiniStack.

Pré-requisito: o ambiente de pé. Se você ainda não subiu nada, comece por [`ambiente-local.md`](ambiente-local.md).

## Índice

- [Preparar](#preparar)
- [O atalho `msaws`](#o-atalho-msaws)
- [1. O emulador está de pé?](#1-o-emulador-está-de-pé)
- [2. Criar os recursos](#2-criar-os-recursos)
- [3. Ver o user pool](#3-ver-o-user-pool)
- [4. Ver quem está no pool](#4-ver-quem-está-no-pool)
- [5. Criar um usuário](#5-criar-um-usuário)
- [6. Definir a senha](#6-definir-a-senha)
- [7. Logar e receber a credencial](#7-logar-e-receber-a-credencial)
- [8. Abrir o token](#8-abrir-o-token)
- [9. A credencial é legítima?](#9-a-credencial-é-legítima)
- [10. Refresh token](#10-refresh-token)
- [Limpar](#limpar)
- [Referência rápida](#referência-rápida)

## Preparar

```sh
cd backend
npm run dev:up
```

> **Portas ocupadas?** Se a 4566 ou a 5432 já estiverem em uso na sua máquina, defina `MINISTACK_PORT` no `.env` (e ajuste o `AWS_ENDPOINT_URL` junto) e suba só o emulador com `docker compose up -d ministack`. Detalhes em [`ambiente-local.md`](ambiente-local.md#problemas-comuns).

## O atalho `msaws`

Cada comando da AWS CLI roda dentro de um container descartável, o que dá uma linha comprida. Defina esta função **uma vez** por sessão de terminal:

```sh
msaws() { docker compose --profile bootstrap run --rm -T --entrypoint aws aws-cli "$@"; }
```

O `--entrypoint aws` devolve o entrypoint original da imagem: você escreve `msaws cognito-idp list-users ...` como se a CLI estivesse instalada na máquina, sem uma camada de aspas no meio.

> **Armadilha comum.** Depois de colar a definição, **chame** a função — não cole o corpo dela solto no terminal. Isso aqui:
>
> ```sh
> docker compose --profile bootstrap run --rm -T --entrypoint aws aws-cli "$@"
> ```
>
> executa com `"$@"` vazio, e a CLI reclama:
>
> ```
> aws: [ERROR]: An error occurred (ParamValidation): the following arguments are required: command
> ```
>
> O certo é `msaws cognito-idp list-user-pools --max-results 10`.

Não quer usar função? Todo comando deste guia funciona trocando `msaws` pelo prefixo completo `docker compose --profile bootstrap run --rm -T --entrypoint aws aws-cli`.

## 1. O emulador está de pé?

```sh
curl -s localhost:4566/_ministack/health
```

## 2. Criar os recursos

```sh
npm run dev:bootstrap
```

```
==> 1/5  User pool
    criado: us-east-1_qIUD3dZ2X
==> 2/5  App client
    criado: FmqGTpouPnk9E3MFqE4R2XDKop
==> 3/5  Bucket S3
    criado: administranest-local
==> 4/5  Usuário de teste
    criado: dev@administranest.local
```

Guarde os dois IDs em variáveis — o resto do guia usa:

```sh
POOL=$(grep POOL_ID .aws-local.env | cut -d= -f2)
CLIENT=$(grep CLIENT_ID .aws-local.env | cut -d= -f2)
```

## 3. Ver o user pool

```sh
msaws cognito-idp list-user-pools --max-results 10 --output table
```

```
------------------------------------------------------------
|                       ListUserPools                      |
+----------------------------------------------------------+
||                        UserPools                       ||
|+-------------------+------------------------------------+|
||  Id               |  us-east-1_qIUD3dZ2X               ||
||  Name             |  administranest-local              ||
|+-------------------+------------------------------------+|
```

O `Id` é o que importa: é ele que a API usa, e é ele que aparece na URL do JWKS. O `Name` só serve para os scripts reencontrarem o pool.

## 4. Ver quem está no pool

```sh
msaws cognito-idp list-users --user-pool-id $POOL \
  --query 'Users[].{Email:Attributes[?Name==`email`].Value|[0],Status:UserStatus}' \
  --output table
```

```
-------------------------------------------
|                ListUsers                |
+---------------------------+-------------+
|           Email           |   Status    |
+---------------------------+-------------+
|  dev@administranest.local |  CONFIRMED  |
+---------------------------+-------------+
```

O `--query` é [JMESPath](https://jmespath.org/), aplicado pela própria CLI antes de imprimir — evita depender do `jq`.

## 5. Criar um usuário

```sh
msaws cognito-idp admin-create-user --user-pool-id $POOL \
  --username teste@administranest.local \
  --user-attributes Name=email,Value=teste@administranest.local Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --query 'User.{Usuario:Username,Status:UserStatus}' --output table
```

```
-------------------------------------------------------------------
|                         AdminCreateUser                         |
+------------------------+----------------------------------------+
|         Status         |                Usuario                 |
+------------------------+----------------------------------------+
|  FORCE_CHANGE_PASSWORD |  d601714a-c2aa-4f60-91de-6c4c176fa496  |
+------------------------+----------------------------------------+
```

**Duas coisas para reparar.**

O `Username` voltou como UUID, não como o e-mail. É o pool estar criado com `--username-attributes email`: o Cognito gera um id interno e trata o e-mail como apelido de login. Você continua logando com o e-mail.

O status é `FORCE_CHANGE_PASSWORD`. Nesse estado o login **não** devolve token — devolve um desafio pedindo troca de senha. Por isso o passo seguinte existe.

O `--message-action SUPPRESS` impede o Cognito de tentar mandar e-mail de convite, que o MiniStack só entrega com `SMTP_HOST` configurado.

## 6. Definir a senha

```sh
msaws cognito-idp admin-set-user-password --user-pool-id $POOL \
  --username teste@administranest.local --password 'Teste@123' --permanent
```

Sem saída = sucesso, jeito Unix. Rode o passo 4 de novo: o status virou `CONFIRMED`.

O `--permanent` é o que evita o desafio `NEW_PASSWORD_REQUIRED` no primeiro login. Sem ele, a senha entra como temporária.

## 7. Logar e receber a credencial

```sh
msaws cognito-idp initiate-auth --client-id $CLIENT \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=teste@administranest.local,PASSWORD=Teste@123 \
  --query 'keys(AuthenticationResult)' --output text
```

```
AccessToken	ExpiresIn	TokenType	RefreshToken	IdToken
```

Repare que este comando **não passa `--user-pool-id`**. O `USER_PASSWORD_AUTH` só precisa do client id — é por isso que o app no celular consegue fazer isso sozinho. O `ADMIN_USER_PASSWORD_AUTH` que o `dev-token.sh` usa exige pool id e credenciais AWS, e por isso só um servidor consegue usá-lo.

Os três tokens têm papéis diferentes:

| Token          | Para quê                                                           |
| -------------- | ------------------------------------------------------------------ |
| `IdToken`      | Quem é o usuário (e-mail, `sub`). É o que a nossa API vai validar  |
| `AccessToken`  | Autoriza chamadas ao próprio Cognito (trocar senha, ler atributos) |
| `RefreshToken` | Pegar um par novo sem pedir a senha de novo                        |

Para guardar o `IdToken`:

```sh
TOKEN=$(msaws cognito-idp initiate-auth --client-id $CLIENT \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=teste@administranest.local,PASSWORD=Teste@123 \
  --query 'AuthenticationResult.IdToken' --output text | tr -d '\r')
```

## 8. Abrir o token

Um JWT são três partes separadas por ponto: header, payload e assinatura. As duas primeiras são só base64 — qualquer um lê.

```sh
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

```json
{
  "sub": "82d373f2-0d12-4163-9b53-074911110e6d",
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_qIUD3dZ2X",
  "token_use": "id",
  "iat": 1787409785,
  "exp": 1787413385,
  "aud": "FmqGTpouPnk9E3MFqE4R2XDKop",
  "cognito:username": "d601714a-c2aa-4f60-91de-6c4c176fa496",
  "email": "teste@administranest.local",
  "email_verified": "true"
}
```

Dois campos merecem atenção:

**`sub`** é o identificador estável do [ADR-02](ADRs/ADR-02-cognito-espelho-usuario.md). É ele que vira coluna no `User` local — não o e-mail, que o usuário pode trocar.

**`iss`** aponta para o domínio da AWS real, saído de um emulador rodando em `localhost`. É a pegadinha do [ADR-12](ADRs/ADR-12-emulacao-local-cognito.md), aqui à vista: um guard que validar issuer contra `localhost` rejeita todo login.

> Que o payload seja legível não é falha. JWT não esconde nada — ele **prova** quem emitiu, via assinatura. Nunca coloque segredo dentro de um.

## 9. A credencial é legítima?

```sh
echo "$TOKEN" | cut -d. -f1 | base64 -d 2>/dev/null | python3 -m json.tool
curl -s "$(grep JWKS .aws-local.env | cut -d= -f2-)" | python3 -m json.tool
```

```json
{ "alg": "RS256", "kid": "ministack-key-1" }
```

```json
{
  "keys": [
    {
      "kty": "RSA",
      "alg": "RS256",
      "use": "sig",
      "kid": "ministack-key-1",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

O `kid` do header aponta qual chave assinou; ele tem que aparecer no JWKS — e aparece. Bater o `kid` é conferência de olho. O `AuthGuard` vai além: pega a chave pública correspondente e verifica a assinatura, que é o que rejeita token adulterado. Foi assim que o [ADR-12](ADRs/ADR-12-emulacao-local-cognito.md) confirmou que os tokens do MiniStack são RS256 de verdade.

## 10. Refresh token

O [ADR-02](ADRs/ADR-02-cognito-espelho-usuario.md) deixa uma pergunta em aberto: se o refresh token expirar, o app offline não consegue sincronizar. Quanto tempo temos?

```sh
msaws cognito-idp describe-user-pool-client --user-pool-id $POOL --client-id $CLIENT \
  --query 'UserPoolClient.{Refresh:RefreshTokenValidity,Access:AccessTokenValidity,Id:IdTokenValidity}'
```

```json
{ "Refresh": 30, "Access": 60, "Id": 60 }
```

**Refresh de 30 dias** (o default do Cognito), access e id de 60 minutos. Ou seja: a usuária pode passar até 30 dias sem sincronizar antes de precisar digitar a senha de novo. Se for pouco para o caso dela, o `create-user-pool-client` aceita até 10 anos.

A troca funciona:

```sh
REFRESH=$(msaws cognito-idp initiate-auth --client-id $CLIENT \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=teste@administranest.local,PASSWORD=Teste@123 \
  --query 'AuthenticationResult.RefreshToken' --output text | tr -d '\r')

msaws cognito-idp initiate-auth --client-id $CLIENT \
  --auth-flow REFRESH_TOKEN_AUTH \
  --auth-parameters REFRESH_TOKEN=$REFRESH \
  --query 'keys(AuthenticationResult)' --output text
```

```
AccessToken	ExpiresIn	TokenType	IdToken
```

Vem `AccessToken` e `IdToken` novos, **sem** `RefreshToken` novo — igual ao Cognito real.

## Limpar

Para apagar só o usuário que você criou:

```sh
msaws cognito-idp admin-delete-user --user-pool-id $POOL --username teste@administranest.local
```

Para zerar tudo e começar do princípio:

```sh
npm run dev:reset
```

## Referência rápida

| O que              | Comando                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Listar pools       | `msaws cognito-idp list-user-pools --max-results 10`                                     |
| Detalhar um pool   | `msaws cognito-idp describe-user-pool --user-pool-id $POOL`                              |
| Listar app clients | `msaws cognito-idp list-user-pool-clients --user-pool-id $POOL`                          |
| Listar usuários    | `msaws cognito-idp list-users --user-pool-id $POOL`                                      |
| Ver um usuário     | `msaws cognito-idp admin-get-user --user-pool-id $POOL --username <email>`               |
| Criar usuário      | `msaws cognito-idp admin-create-user --user-pool-id $POOL --username <email>`            |
| Definir senha      | `msaws cognito-idp admin-set-user-password ... --permanent`                              |
| Apagar usuário     | `msaws cognito-idp admin-delete-user --user-pool-id $POOL --username <email>`            |
| Login (como o app) | `msaws cognito-idp initiate-auth --client-id $CLIENT --auth-flow USER_PASSWORD_AUTH ...` |
| Token rápido       | `npm run dev:token`                                                                      |
| Listar buckets     | `msaws s3 ls`                                                                            |
| Listar objetos     | `msaws s3 ls s3://administranest-local`                                                  |

O MiniStack implementa 84 operações do Cognito. Se a AWS CLI aceita, provavelmente funciona: `msaws cognito-idp help` lista todas.
