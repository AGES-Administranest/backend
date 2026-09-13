#!/bin/bash
#
# Cria os recursos AWS que o projeto usa, dentro do MiniStack.
# Roda no container `aws-cli` (ver docker-compose.yml), nunca na sua máquina.
#
#   npm run dev:bootstrap
#
# É idempotente: cada etapa consulta antes de criar, então rodar duas vezes
# não quebra nem duplica nada.

set -euo pipefail

# Os nomes vêm do docker-compose.yml, para não ficarem duplicados entre este
# script e o dev-token.sh. O `:?` aborta com mensagem clara se faltar, em vez
# de criar um recurso com nome vazio.
POOL_NAME="${COGNITO_POOL_NAME:?defina COGNITO_POOL_NAME (vem do docker-compose.yml)}"
CLIENT_NAME="${COGNITO_CLIENT_NAME:?defina COGNITO_CLIENT_NAME}"
BUCKET="${S3_BUCKET:?defina S3_BUCKET (vem do seu .env)}"
DEV_EMAIL="${DEV_EMAIL:?defina DEV_EMAIL}"
DEV_PASSWORD="${DEV_PASSWORD:?defina DEV_PASSWORD}"
DEV_NAME="${DEV_NAME:-Dev Local}"
DOMAIN_PREFIX="${COGNITO_DOMAIN_PREFIX:?defina COGNITO_DOMAIN_PREFIX}"
OIDC_MOCK_HOST_URL="${OIDC_MOCK_HOST_URL:?defina OIDC_MOCK_HOST_URL}"
OIDC_MOCK_INTERNAL_URL="${OIDC_MOCK_INTERNAL_URL:?defina OIDC_MOCK_INTERNAL_URL}"
CALLBACK_URLS="${COGNITO_CALLBACK_URLS:?defina COGNITO_CALLBACK_URLS}"
LOGOUT_URLS="${COGNITO_LOGOUT_URLS:?defina COGNITO_LOGOUT_URLS}"

# Os provedores sociais, com o nome que o app manda em `identity_provider`.
# É o nome que a AWS reserva para o tipo nativo — ver ADR-13.
SOCIAL_PROVIDERS=(Google)
# Provedores que já foram criados por versões anteriores deste script e saíram
# de escopo. Removidos do pool para não ficarem aceitos no app client.
RETIRED_PROVIDERS=(SignInWithApple)

ENV_FILE='/workspace/.aws-local.env'
HOST_ENDPOINT_URL="${HOST_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

# O AWS_ENDPOINT_URL do ambiente já redireciona a CLI para o MiniStack,
# mas passamos explícito para o script não depender da versão da CLI.
aws() { command aws --endpoint-url "${AWS_ENDPOINT_URL}" "$@"; }

echo '==> 1/7  User pool'
POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 \
  --query "UserPools[?Name=='${POOL_NAME}'].Id | [0]" --output text)

if [ "${POOL_ID}" = 'None' ] || [ -z "${POOL_ID}" ]; then
  POOL_ID=$(aws cognito-idp create-user-pool \
    --pool-name "${POOL_NAME}" \
    --auto-verified-attributes email \
    --username-attributes email \
    --query 'UserPool.Id' --output text)
  echo "    criado: ${POOL_ID}"
else
  echo "    já existe: ${POOL_ID}"
fi

echo '==> 2/7  Domínio do pool'
# Na AWS é o domínio que serve /oauth2/authorize, /oauth2/token e /logout.
# O MiniStack serve esses caminhos na própria porta 4566, então aqui o domínio
# é só registro — mas criá-lo mantém o roteiro igual ao de produção.
EXISTING_DOMAIN=$(aws cognito-idp describe-user-pool-domain --domain "${DOMAIN_PREFIX}" \
  --query 'DomainDescription.UserPoolId' --output text 2>/dev/null || true)

if [ "${EXISTING_DOMAIN}" = "${POOL_ID}" ]; then
  echo "    já existe: ${DOMAIN_PREFIX}"
else
  aws cognito-idp create-user-pool-domain \
    --user-pool-id "${POOL_ID}" \
    --domain "${DOMAIN_PREFIX}" >/dev/null
  echo "    criado: ${DOMAIN_PREFIX}"
fi

echo '==> 3/7  Provedor social (IdP fake)'
# Em produção é do tipo `Google`, com as credenciais do Google Cloud. O
# MiniStack só federa OIDC genérico, então ele aponta para o oidc-mock. O nome
# é o que importa: é ele que o app manda, e é igual nos dois ambientes.
#
# `authorize_url` é aberta pelo navegador (host); `token_url` e `jwks_uri`
# são chamadas pelo MiniStack (rede do Compose).
ATTRIBUTE_MAPPING='{"email":"email","name":"name","email_verified":"email_verified"}'

for PROVIDER in "${SOCIAL_PROVIDERS[@]}"; do
  ISSUER_PATH=$(echo "${PROVIDER}" | tr '[:upper:]' '[:lower:]')
  DETAILS=$(cat <<JSON
{
  "client_id": "local-${ISSUER_PATH}",
  "client_secret": "local",
  "authorize_scopes": "openid email profile",
  "attributes_request_method": "GET",
  "oidc_issuer": "${OIDC_MOCK_HOST_URL}/${ISSUER_PATH}",
  "authorize_url": "${OIDC_MOCK_HOST_URL}/${ISSUER_PATH}/authorize",
  "token_url": "${OIDC_MOCK_INTERNAL_URL}/${ISSUER_PATH}/token",
  "jwks_uri": "${OIDC_MOCK_INTERNAL_URL}/${ISSUER_PATH}/jwks"
}
JSON
)

  if aws cognito-idp describe-identity-provider --user-pool-id "${POOL_ID}" \
    --provider-name "${PROVIDER}" >/dev/null 2>&1; then
    # Atualiza sempre: quem mudou OIDC_MOCK_PORT precisa das URLs novas.
    aws cognito-idp update-identity-provider \
      --user-pool-id "${POOL_ID}" \
      --provider-name "${PROVIDER}" \
      --provider-details "${DETAILS}" \
      --attribute-mapping "${ATTRIBUTE_MAPPING}" >/dev/null
    echo "    atualizado: ${PROVIDER}"
  else
    aws cognito-idp create-identity-provider \
      --user-pool-id "${POOL_ID}" \
      --provider-name "${PROVIDER}" \
      --provider-type OIDC \
      --provider-details "${DETAILS}" \
      --attribute-mapping "${ATTRIBUTE_MAPPING}" >/dev/null
    echo "    criado: ${PROVIDER}"
  fi
done

for PROVIDER in "${RETIRED_PROVIDERS[@]}"; do
  if aws cognito-idp describe-identity-provider --user-pool-id "${POOL_ID}" \
    --provider-name "${PROVIDER}" >/dev/null 2>&1; then
    aws cognito-idp delete-identity-provider \
      --user-pool-id "${POOL_ID}" \
      --provider-name "${PROVIDER}"
    echo "    removido: ${PROVIDER}"
  fi
done

echo '==> 4/7  App client'
IFS=',' read -r -a CALLBACKS <<<"${CALLBACK_URLS}"
IFS=',' read -r -a LOGOUTS <<<"${LOGOUT_URLS}"

# Uma lista só, usada tanto na criação quanto na atualização: o
# `update-user-pool-client` zera todo campo que não for enviado, então
# esquecer um aqui desliga o login por senha sem aviso.
CLIENT_SETTINGS=(
  --explicit-auth-flows ALLOW_ADMIN_USER_PASSWORD_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH
  --supported-identity-providers COGNITO "${SOCIAL_PROVIDERS[@]}"
  --callback-urls "${CALLBACKS[@]}"
  --logout-urls "${LOGOUTS[@]}"
  # Authorization code + PKCE. O fluxo `implicit` devolveria o token na URL.
  --allowed-o-auth-flows code
  --allowed-o-auth-scopes openid email profile
  --allowed-o-auth-flows-user-pool-client
)

CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "${POOL_ID}" --max-results 60 \
  --query "UserPoolClients[?ClientName=='${CLIENT_NAME}'].ClientId | [0]" --output text)

if [ "${CLIENT_ID}" = 'None' ] || [ -z "${CLIENT_ID}" ]; then
  # Sem client secret: o app mobile é um cliente público e não tem
  # onde guardar segredo. Quem prova a identidade é o usuário, não o app.
  CLIENT_ID=$(aws cognito-idp create-user-pool-client \
    --user-pool-id "${POOL_ID}" \
    --client-name "${CLIENT_NAME}" \
    --no-generate-secret \
    "${CLIENT_SETTINGS[@]}" \
    --query 'UserPoolClient.ClientId' --output text)
  echo "    criado: ${CLIENT_ID}"
else
  # Atualiza sempre, para quem rodou o bootstrap antes do login social existir.
  aws cognito-idp update-user-pool-client \
    --user-pool-id "${POOL_ID}" \
    --client-id "${CLIENT_ID}" \
    --client-name "${CLIENT_NAME}" \
    "${CLIENT_SETTINGS[@]}" >/dev/null
  echo "    já existe, configuração OAuth aplicada: ${CLIENT_ID}"
fi

echo '==> 5/7  Bucket S3'
if aws s3api head-bucket --bucket "${BUCKET}" >/dev/null 2>&1; then
  echo "    já existe: ${BUCKET}"
else
  aws s3api create-bucket --bucket "${BUCKET}" >/dev/null
  echo "    criado: ${BUCKET}"
fi

# CORS liberal, só para o ambiente local: o app faz PUT direto no bucket
# (ADR-03) e, no navegador ou WebView, sem CORS o upload falha no preflight.
aws s3api put-bucket-cors --bucket "${BUCKET}" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}' >/dev/null
echo '    CORS aplicado'

echo '==> 6/7  Usuário de teste'
if aws cognito-idp admin-get-user --user-pool-id "${POOL_ID}" --username "${DEV_EMAIL}" >/dev/null 2>&1; then
  echo "    já existe: ${DEV_EMAIL}"
else
  # Via admin porque o MiniStack só entrega e-mail de confirmação com
  # SMTP_HOST configurado — o fluxo normal de sign-up ficaria travado.
  aws cognito-idp admin-create-user \
    --user-pool-id "${POOL_ID}" \
    --username "${DEV_EMAIL}" \
    --user-attributes "Name=email,Value=${DEV_EMAIL}" Name=email_verified,Value=true \
    --message-action SUPPRESS >/dev/null
  echo "    criado: ${DEV_EMAIL}"
fi

# Outside the if/else on purpose: whoever already ran the bootstrap never hits
# the creation branch again, and would keep a token with no `name` claim.
aws cognito-idp admin-update-user-attributes \
  --user-pool-id "${POOL_ID}" \
  --username "${DEV_EMAIL}" \
  --user-attributes "Name=name,Value=${DEV_NAME}" >/dev/null
echo "    atributo name: ${DEV_NAME}"

# `--permanent` evita o desafio NEW_PASSWORD_REQUIRED no primeiro login.
aws cognito-idp admin-set-user-password \
  --user-pool-id "${POOL_ID}" \
  --username "${DEV_EMAIL}" \
  --password "${DEV_PASSWORD}" \
  --permanent
echo '    senha definida'

echo '==> 7/7  Gravando .aws-local.env'
cat > "${ENV_FILE}" <<ENV
# Gerado por scripts/bootstrap-aws.sh — não edite à mão, não versione.
# Regerar: npm run dev:bootstrap · zerar tudo: npm run dev:reset
COGNITO_USER_POOL_ID=${POOL_ID}
COGNITO_CLIENT_ID=${CLIENT_ID}
COGNITO_JWKS_URI=${HOST_ENDPOINT_URL}/${POOL_ID}/.well-known/jwks.json
# O emulador emite o issuer da AWS real; validar contra o localhost rejeita
# todo token. Ver ADR-12.
COGNITO_ISSUER=https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}
# Base de /oauth2/authorize e /oauth2/token para o login social (ADR-13). A API
# não usa; é o valor que o app mobile precisa. Em produção é o domínio do pool:
# https://<prefixo>.auth.<região>.amazoncognito.com
COGNITO_OAUTH_URL=${HOST_ENDPOINT_URL}
# S3_BUCKET não entra aqui: o nome do bucket é escolhido por você e mora no
# .env. Este arquivo só carrega o que não existia antes do bootstrap rodar.
ENV
echo "    ${ENV_FILE#/workspace/}"

echo
echo '==================== pronto ===================='
echo "Login de teste: ${DEV_EMAIL} / ${DEV_PASSWORD}"
echo "Login social: ${OIDC_MOCK_HOST_URL} faz o papel de ${SOCIAL_PROVIDERS[*]} — digite qualquer e-mail"
echo 'IdToken (Authorization: Bearer ...):'
echo
bash /scripts/dev-token.sh
