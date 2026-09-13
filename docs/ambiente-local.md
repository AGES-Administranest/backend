# Ambiente de desenvolvimento local

O projeto depende de dois serviços AWS: **Cognito** para autenticação ([ADR-02](ADRs/ADR-02-cognito-espelho-usuario.md)) e **S3** para upload de arquivos ([ADR-03](ADRs/ADR-03-upload-presigned-url.md)). Este documento explica como ter os dois rodando na sua máquina, sem conta AWS e sem credencial de verdade.

## Índice

- [O que é o MiniStack](#o-que-é-o-ministack)
- [Fluxo do dia a dia](#fluxo-do-dia-a-dia)
- [O que o bootstrap cria](#o-que-o-bootstrap-cria)
- [Os dois arquivos de variáveis](#os-dois-arquivos-de-variáveis)
- [Pegando um token](#pegando-um-token)
- [Login social local](#login-social-local)
- [E-mails de confirmação](#e-mails-de-confirmação)
- [Conferindo que está tudo de pé](#conferindo-que-está-tudo-de-pé)
- [Resetar](#resetar)
- [Apontando o app mobile para cá](#apontando-o-app-mobile-para-cá)
- [Problemas comuns](#problemas-comuns)
- [Explorando na mão](#explorando-na-mão)

## O que é o MiniStack

O [MiniStack](https://ministack.org) é **um emulador da AWS rodando localmente**.
Não é uma biblioteca importada no código — é um processo rodando localmente em docker configurado para escutar na porta `4566` que responde exatamente os mesmos payloads que os serviços da AWS responderiam.

```
                 mesma requisição HTTP, mesmo protocolo AWS
                 ─────────────────────────────────────────►
                                              ┌───────────────────────────┐
  seu código   ┌──────────────────────┐       │ AWS de verdade (produção) │
  (NestJS)  ───│ @aws-sdk/client-...  │───────┤            ou             │
               └──────────────────────┘       │ MiniStack (localhost:4566)│
                    ▲                         └───────────────────────────┘
                    │
       o SDK não sabe (nem se importa) com qual dos dois está falando
```

**A única diferença entre local e produção é a string do `endpoint`.** Esse é o ponto inteiro de usar um emulador: o código que roda na sua máquina é o mesmo que vai para a AWS. Você usa o AWS SDK normal (`@aws-sdk/client-*`), que é TypeScript nativo, e aponta ele para outro lugar.

O emulador cobre Cognito e S3, que são os dois serviços de que precisamos. O **Postgres continua sendo o container `postgres:16-alpine`** do Compose; não usamos o banco emulado. O motivo da escolha e os achados dos testes estão no [ADR-12](ADRs/ADR-12-emulacao-local-cognito.md).

## Fluxo do dia a dia

Quem está clonando o repositório agora:

```sh
nvm use
npm ci
cp .env.example .env

npm run dev:setup        # sobe containers, cria os recursos AWS e aplica as migrations
npm run start:dev        # API em http://localhost:3000
```

`dev:setup` é o atalho: espera Postgres e MiniStack subirem (`docker compose up -d --wait`), roda o bootstrap e aplica as migrations — os três passos abaixo, um atrás do outro. Só precisa rodar **uma vez**; o estado do emulador fica em `docker/ministack-data/` e sobrevive ao `dev:down`. Nos dias seguintes, `npm run dev:up` e pronto.

Se algum passo falhar isoladamente (ex.: as migrations, porque o schema mudou), rode-o sozinho em vez de repetir o `dev:setup` inteiro:

| Script                  | O que faz                                                               |
| ----------------------- | ----------------------------------------------------------------------- |
| `npm run dev:setup`     | `dev:up` + `dev:bootstrap` + `prisma migrate dev`, em sequência         |
| `npm run dev:up`        | Sobe os containers (Postgres, MiniStack e o IdP fake) em background     |
| `npm run dev:bootstrap` | Cria os recursos AWS. Idempotente — rodar de novo não quebra            |
| `npm run dev:token`     | Imprime um `IdToken` novo do usuário de teste                           |
| `npm run dev:social-token` | Imprime um `IdToken` de uma conta de login social (Google fake) |
| `npm run dev:down`      | Derruba os containers. O estado persiste                                |
| `npm run dev:reset`     | Derruba **e apaga tudo**: volumes, estado do emulador e o `.env` gerado |

### Como esses scripts funcionam

O `dev:bootstrap` e o `dev:token` rodam dentro de um container `amazon/aws-cli` descartável:

```
docker compose --profile bootstrap run --rm aws-cli /scripts/bootstrap-aws.sh
                └──────────┬─────────┘  └─┬─┘ └──┬─┘ └────────┬────────────┘
                    serviço com profile   │      │       script montado em
                    não sobe no `up`      │      │       /scripts (read-only)
                                          │      │
                          apaga o container      nome do serviço
                          quando terminar        no docker-compose.yml
```

**Ninguém instala AWS CLI na máquina.** O `profiles: [bootstrap]` no Compose faz esse serviço não subir no `docker compose up` comum — ele só existe durante o segundo em que o script roda.

## O que o bootstrap cria

O [`scripts/bootstrap-aws.sh`](../scripts/bootstrap-aws.sh) faz sete coisas, cada uma consultando antes de criar (por isso é idempotente):

| #   | Recurso                                                | Detalhe que importa                                                                                                        |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | User pool `administranest-local`                       | Login por e-mail (`--username-attributes email`)                                                                           |
| 2   | Domínio `administranest-local`                         | Na AWS é quem serve `/oauth2/*`; no MiniStack esses caminhos já respondem na 4566, o domínio é só registro                 |
| 3   | Provedor `Google`                                      | Do tipo OIDC, apontando para o `oidc-mock` — o emulador não tem o tipo nativo ([ADR-13](ADRs/ADR-13-login-social.md))      |
| 4   | App client `administranest-mobile`                     | **Sem client secret** — o app mobile é cliente público: o binário está no celular do usuário, segredo ali não protege nada. Com OAuth `code` e as callback URLs do app |
| 5   | Bucket com o nome do `S3_BUCKET` do seu `.env`         | Com CORS liberal, porque o app dá `PUT` direto no bucket (ADR-03) e sem CORS o preflight derruba o upload                  |
| 6   | Usuário `dev@administranest.local` / senha `Dev@12345` | Criado pela via admin: o MiniStack só manda e-mail de confirmação com `SMTP_HOST`, então o sign-up normal ficaria travado  |
| 7   | Arquivo `.aws-local.env`                               | Só os IDs e endereços que o Cognito gerou — o resto já estava no seu `.env`                                                |

Quem já tinha rodado o bootstrap antes do login social só precisa rodar de novo: os passos 2 a 4 aplicam a configuração nova no pool existente, sem apagar usuários.

No fim, ele imprime um `IdToken` pronto para colar em `Authorization: Bearer`.

## Os dois arquivos de variáveis

Isso costuma confundir, então vale ser explícito. O critério que separa os dois é este:

> **`.env` = o que você escolhe. `.aws-local.env` = o que só existe depois de criado.**

| Arquivo          | Origem                       | Contém                                                                  |
| ---------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `.env`           | Você copia do `.env.example` | `DATABASE_URL`, `PORT`, endpoint e credenciais fake da AWS, `S3_BUCKET` |
| `.aws-local.env` | Gerado pelo `dev:bootstrap`  | `COGNITO_*` — os IDs que a AWS gera na criação do pool                  |

Os dois são gitignored. Estão separados porque o script **reescreve** o `.aws-local.env` a cada execução: se fossem o mesmo arquivo, o bootstrap apagaria a sua `DATABASE_URL` toda vez.

**Por que o bucket fica de um lado e o pool do outro.** Parece incoerente, mas é a diferença entre os dois serviços:

- **O S3 não tem "id" separado — o nome _é_ o identificador.** A API vai chamar `new PutObjectCommand({ Bucket: 'administranest-local' })` com esse nome literal. É um valor que você decide de antemão, então mora no `.env`, e o bootstrap lê de lá para saber o que criar.
- **O Cognito gera um id.** O nome que você dá ao pool nunca chega na API: ela usa o `us-east-1_xxxxxxxxx` devolvido pelo `create-user-pool`. O nome só serve para o script reencontrar o pool na segunda execução, e por isso vive no `docker-compose.yml`, junto dos outros parâmetros do bootstrap.

Se `S3_BUCKET` estivesse nos dois arquivos, o `.env` venceria (é o primeiro da lista) e você poderia acabar com a API apontando para um bucket que o bootstrap nunca criou. Uma chave, um dono.

O `.aws-local.env` sai assim:

```
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_JWKS_URI=http://localhost:4566/us-east-1_xxxxxxxxx/.well-known/jwks.json
COGNITO_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxxxxxx
COGNITO_OAUTH_URL=http://localhost:4566
```

`COGNITO_OAUTH_URL` não é lido pela API: é o valor que o app mobile usa para abrir o login social.

**Não "conserte" o `COGNITO_ISSUER` para `localhost`.** Parece errado, mas não é: o emulador emite tokens com o issuer da AWS real, e validar contra `localhost` rejeita todo login. O lado bom é que esse valor é idêntico em local e em produção. Detalhes no [ADR-12](ADRs/ADR-12-emulacao-local-cognito.md).

**Credenciais `test`/`test` no `.env.example` não são vazamento.** O MiniStack não valida credencial nenhuma — qualquer string funciona. Em produção essas variáveis não existem: `AWS_ENDPOINT_URL` fica vazio (o SDK resolve a AWS real sozinho) e as credenciais vêm da role da máquina, nunca de arquivo.

## Pegando um token

```sh
npm run dev:token
```

O script imprime **só o token**, sem enfeite, para poder ser usado dentro de outro comando:

```sh
curl -H "Authorization: Bearer $(npm run --silent dev:token)" localhost:3000/users
```

O token vale **1 hora**. Para inspecionar o conteúdo, cole em [jwt.io](https://jwt.io) ou:

```sh
npm run --silent dev:token | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

## Login social local

"Continuar com Google" funciona sem conta no Google. O `oidc-mock` (porta `8090`) faz o papel dele: quando o app abre o login do Google, o que aparece é a tela dele. **Digite um e-mail no campo de usuário** — ele vira a identidade da conta; o campo de claims é opcional (ex.: `{"name": "Ana"}`).

Para testar a API sem o app:

```sh
npm run --silent dev:social-token                                      # ana.google@example.com
npm run --silent dev:social-token -- Google bia@gmail.com "Bia Google"

curl -X POST -H "Authorization: Bearer $(npm run --silent dev:social-token)" localhost:3000/auth/session
```

O script faz por HTTP o mesmo caminho que o navegador do app faria. O desenho, as diferenças para a AWS real e o que falta decidir (a mesma pessoa com conta de senha e conta Google) estão no [ADR-13](ADRs/ADR-13-login-social.md).

**Use um e-mail novo a cada login com Google.** O emulador troca o `sub` da conta federada a partir do segundo login com o mesmo usuário, e a API passa a responder `409` como se fosse outra pessoa com o mesmo e-mail (divergência 6 do ADR-13). Vale para o app e para o `dev:social-token`. Na AWS isso não acontece.

## E-mails de confirmação

**Localmente nenhum e-mail sai da sua máquina** — nem para um endereço real. O MiniStack só registra a mensagem internamente, e o código de confirmação é sempre `123456`; na verdade qualquer código é aceito (divergências no [ADR-12](ADRs/ADR-12-emulacao-local-cognito.md)). Na AWS o Cognito envia o código para o e-mail informado; para uso real, o pool deve mandar pelo SES com domínio verificado, porque o remetente padrão do Cognito tem limite baixo de envios por dia.

**Expo Go num celular físico:** o endereço de retorno do app inclui o IP da sua rede, e o Cognito só aceita endereços cadastrados. Acrescente o seu no `.env` e rode o bootstrap de novo:

```
COGNITO_CALLBACK_URLS=administranest://auth/callback,exp://127.0.0.1:8081/--/auth/callback,http://localhost:8081/auth/callback,exp://192.168.0.10:8081/--/auth/callback
```

O navegador do celular também precisa alcançar o `oidc-mock` e o MiniStack; como os redirects apontam para `localhost`, o login social local funciona no simulador iOS e no Expo web, e num aparelho físico só com túnel. É uma limitação do ambiente local, não do fluxo.

## Conferindo que está tudo de pé

```sh
# 1. o emulador responde
curl -s localhost:4566/_ministack/health

# 2. o bucket existe
docker compose --profile bootstrap run --rm aws-cli \
  -c 'aws s3 ls --endpoint-url http://ministack:4566'

# 3. o JWKS tem chave (o guard vai baixar daqui)
curl -s "$(grep JWKS .aws-local.env | cut -d= -f2-)"

# 4. sai um token
npm run dev:token
```

## Resetar (Atenção: apaga tudo!)

```sh
npm run dev:reset
```

Derruba os containers com `-v` (apaga o volume do Postgres e todos dados do banco) e remove `docker/ministack-data/` e `.aws-local.env`. É o botão de pânico quando o estado local ficou estranho — depois é só `dev:up`, `dev:bootstrap` e `npx prisma migrate dev` de novo.

**Por que o apagar passa por um container.** Olhando o script você vai ver algo estranho:

```
docker compose run --rm --no-deps aws-cli -c "rm -rf /workspace/docker/ministack-data"
```

Um `rm -rf docker/ministack-data` direto seria mais simples — e falha. O MiniStack roda como `root` dentro do container e grava os arquivos de estado com esse dono; do lado de fora, o seu usuário não tem permissão de apagá-los. A saída é apagar de dentro de um container, que também roda como root. O `--no-deps` é o que impede o Compose de levantar o MiniStack de volta só para rodar o `rm`.

## Apontando o app mobile para cá

O app autentica **direto no Cognito** e manda o token para a API (ADR-02). Como React Native roda JavaScript, ele usa o mesmo `@aws-sdk/client-cognito-identity-provider` do backend — só muda o endereço, porque `localhost` dentro de um emulador é o próprio emulador, não a sua máquina:

| Onde o app roda  | Endpoint do MiniStack         | Endpoint da API               |
| ---------------- | ----------------------------- | ----------------------------- |
| Emulador Android | `http://10.0.2.2:4566`        | `http://10.0.2.2:3000`        |
| Simulador iOS    | `http://localhost:4566`       | `http://localhost:3000`       |
| Celular físico   | `http://<IP-da-sua-LAN>:4566` | `http://<IP-da-sua-LAN>:3000` |

O `10.0.2.2` é um endereço especial do emulador do Android que aponta para o host. Para celular físico, descubra seu IP com `ip addr | grep 'inet 192'` e garanta que celular e computador estão no mesmo Wi-Fi.

Esses três endereços vão no `.env` do **client-mobile** (`EXPO_PUBLIC_COGNITO_ENDPOINT`, `EXPO_PUBLIC_COGNITO_OAUTH_URL` e `EXPO_PUBLIC_API_URL`). Se você mudou o `MINISTACK_PORT`, use a porta nova nos dois primeiros.

### Celular físico: o `AWS_ENDPOINT_URL` daqui também muda

O upload da nota (US10) não passa pela API: ela só assina a policy, e **o celular POSTa direto no bucket**. A URL desse POST não sai do `.env` do app — sai daqui, porque é o endereço com que este backend montou o cliente S3 (`s3-document-storage.ts`) que volta no campo `url` da resposta. Com `localhost`, o celular tenta subir o arquivo contra si mesmo.

Então, para testar em aparelho físico, no `.env` **deste** repositório:

```
AWS_ENDPOINT_URL=http://<IP-da-sua-LAN>:4566
```

Funciona porque o backend roda fora do Docker (`npm run start:dev`) e alcança o próprio IP da LAN; a mesma variável serve para o `HeadObject` dele e para a URL que o celular recebe. A porta já sai publicada em `0.0.0.0`, então do lado do Docker não falta nada — o que costuma faltar é liberar o firewall do host.

**Trocar o host não invalida a assinatura.** No presigned POST o que é assinado é o policy document (bucket, key, Content-Type, content-length-range), não o Host — ao contrário do presigned GET/PUT, em que o endereço entra na query string.

Dois avisos para o mesmo cenário:

- **Login social em aparelho físico só funciona com túnel**, porque os redirects do `oidc-mock` apontam para `localhost` (mesma limitação registrada em "E-mails de confirmação"). Login por e-mail e senha funciona normal.
- **`COGNITO_ISSUER` não é afetado** pela troca de endereço: o emulador emite o issuer da AWS real, e é isso que o bootstrap grava. Ver ADR-12.

## Explorando na mão

Para conhecer o Cognito antes de escrever código — ver o pool, criar um usuário, logar e abrir o token —, siga o roteiro passo a passo em **[`cognito-na-pratica.md`](cognito-na-pratica.md)**.

## Problemas comuns

**`Bind for 0.0.0.0:4566 failed: port is already allocated`** — outra coisa já usa a porta. Defina `MINISTACK_PORT` no seu `.env` (o Docker Compose lê esse arquivo sozinho) e ajuste o `AWS_ENDPOINT_URL` junto:

```
MINISTACK_PORT=4567
AWS_ENDPOINT_URL=http://localhost:4567
```

Depois rode `npm run dev:bootstrap` de novo — ele regrava o `.aws-local.env` com a porta nova.

**`dev:bootstrap` falha dizendo que não conecta** — o `aws-cli` espera o healthcheck do MiniStack passar antes de rodar. Se falhou mesmo assim, veja o log: `docker compose logs ministack`.

**O token é rejeitado pelo guard** — confira nesta ordem: o `COGNITO_ISSUER` está com o domínio da AWS (e não `localhost`)? O `COGNITO_JWKS_URI` inclui o pool id no caminho? Um token velho (>1h) expirou? As divergências conhecidas entre o emulador e a AWS real estão registradas no [ADR-12](ADRs/ADR-12-emulacao-local-cognito.md).

**`Permission denied` ao apagar `docker/ministack-data/` na mão** — os arquivos são do `root`, escritos pelo container. Use `npm run dev:reset`, que apaga de dentro de um container. Se precisar apagar só essa pasta:

```sh
docker compose run --rm --no-deps aws-cli -c "rm -rf /workspace/docker/ministack-data"
```

**Mudei o `S3_BUCKET` no `.env` e o upload quebrou** — o bucket novo não existe até alguém criar. Rode `npm run dev:bootstrap` de novo; ele cria o bucket com o nome novo (o antigo continua lá, inofensivo).

**Mudei de branch e o pool sumiu** — `docker/ministack-data/` é gitignored, então ele não muda com a branch. Se sumiu, alguém rodou `dev:reset`. Só rodar `dev:bootstrap`.
