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

ENV_FILE='/workspace/.aws-local.env'
HOST_ENDPOINT_URL="${HOST_ENDPOINT_URL:-http://localhost:4566}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

# O AWS_ENDPOINT_URL do ambiente já redireciona a CLI para o MiniStack,
# mas passamos explícito para o script não depender da versão da CLI.
aws() { command aws --endpoint-url "${AWS_ENDPOINT_URL}" "$@"; }

echo '==> 1/5  User pool'
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

echo '==> 2/5  App client'
CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "${POOL_ID}" --max-results 60 \
  --query "UserPoolClients[?ClientName=='${CLIENT_NAME}'].ClientId | [0]" --output text)

if [ "${CLIENT_ID}" = 'None' ] || [ -z "${CLIENT_ID}" ]; then
  # Sem client secret: o app mobile é um cliente público e não tem
  # onde guardar segredo. Quem prova a identidade é o usuário, não o app.
  CLIENT_ID=$(aws cognito-idp create-user-pool-client \
    --user-pool-id "${POOL_ID}" \
    --client-name "${CLIENT_NAME}" \
    --no-generate-secret \
    --explicit-auth-flows ALLOW_ADMIN_USER_PASSWORD_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --query 'UserPoolClient.ClientId' --output text)
  echo "    criado: ${CLIENT_ID}"
else
  echo "    já existe: ${CLIENT_ID}"
fi

echo '==> 3/5  Bucket S3'
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

echo '==> 4/5  Usuário de teste'
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

# `--permanent` evita o desafio NEW_PASSWORD_REQUIRED no primeiro login.
aws cognito-idp admin-set-user-password \
  --user-pool-id "${POOL_ID}" \
  --username "${DEV_EMAIL}" \
  --password "${DEV_PASSWORD}" \
  --permanent
echo '    senha definida'

echo '==> 5/5  Gravando .aws-local.env'
cat > "${ENV_FILE}" <<ENV
# Gerado por scripts/bootstrap-aws.sh — não edite à mão, não versione.
# Regerar: npm run dev:bootstrap · zerar tudo: npm run dev:reset
COGNITO_USER_POOL_ID=${POOL_ID}
COGNITO_CLIENT_ID=${CLIENT_ID}
COGNITO_JWKS_URI=${HOST_ENDPOINT_URL}/${POOL_ID}/.well-known/jwks.json
# O emulador emite o issuer da AWS real; validar contra o localhost rejeita
# todo token. Ver ADR-12.
COGNITO_ISSUER=https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}
# S3_BUCKET não entra aqui: o nome do bucket é escolhido por você e mora no
# .env. Este arquivo só carrega o que não existia antes do bootstrap rodar.
ENV
echo "    ${ENV_FILE#/workspace/}"

echo
echo '==================== pronto ===================='
echo "Login de teste: ${DEV_EMAIL} / ${DEV_PASSWORD}"
echo 'IdToken (Authorization: Bearer ...):'
echo
bash /scripts/dev-token.sh
