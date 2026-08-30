#!/bin/bash
#
# Imprime um IdToken novo do usuário de teste — e nada mais, para poder ser
# usado dentro de outro comando:
#
#   npm run dev:token
#   curl -H "Authorization: Bearer $(npm run --silent dev:token)" localhost:3000/...
#
# Precisa do `npm run dev:bootstrap` já executado (é ele quem cria o pool).

set -euo pipefail

# Mesmos valores do bootstrap, vindos do docker-compose.yml.
POOL_NAME="${COGNITO_POOL_NAME:?defina COGNITO_POOL_NAME (vem do docker-compose.yml)}"
CLIENT_NAME="${COGNITO_CLIENT_NAME:?defina COGNITO_CLIENT_NAME}"
DEV_EMAIL="${DEV_EMAIL:?defina DEV_EMAIL}"
DEV_PASSWORD="${DEV_PASSWORD:?defina DEV_PASSWORD}"

aws() { command aws --endpoint-url "${AWS_ENDPOINT_URL}" "$@"; }

POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 \
  --query "UserPools[?Name=='${POOL_NAME}'].Id | [0]" --output text)

if [ "${POOL_ID}" = 'None' ] || [ -z "${POOL_ID}" ]; then
  echo "Pool '${POOL_NAME}' não existe. Rode: npm run dev:bootstrap" >&2
  exit 1
fi

CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "${POOL_ID}" --max-results 60 \
  --query "UserPoolClients[?ClientName=='${CLIENT_NAME}'].ClientId | [0]" --output text)

aws cognito-idp admin-initiate-auth \
  --user-pool-id "${POOL_ID}" \
  --client-id "${CLIENT_ID}" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=${DEV_EMAIL},PASSWORD=${DEV_PASSWORD}" \
  --query 'AuthenticationResult.IdToken' --output text
