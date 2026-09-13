#!/bin/bash
#
# Imprime um IdToken de uma conta de login social — e nada mais, igual ao
# dev-token.sh, para poder ser usado dentro de outro comando:
#
#   npm run dev:social-token                         # Google, ana.google@example.com
#   npm run dev:social-token -- SignInWithApple bia@icloud.com "Bia Apple"
#   curl -X POST -H "Authorization: Bearer $(npm run --silent dev:social-token)" localhost:3000/auth/session
#
# Faz, por HTTP, o caminho que o navegador do app faz (ADR-13):
#
#   /oauth2/authorize?identity_provider=Google  →  oidc-mock (login)
#   →  /oauth2/idpresponse  →  redirect_uri?code=...  →  /oauth2/token
#
# PKCE fica de fora: o MiniStack não confere o code_verifier de login federado.
# O app manda mesmo assim, porque na AWS real ele é conferido.
#
# Precisa do `npm run dev:bootstrap` já executado e do oidc-mock de pé.

set -euo pipefail

PROVIDER="${1:-Google}"
EMAIL="${2:-ana.google@example.com}"
NAME="${3:-Ana Google}"

POOL_NAME="${COGNITO_POOL_NAME:?defina COGNITO_POOL_NAME (vem do docker-compose.yml)}"
CLIENT_NAME="${COGNITO_CLIENT_NAME:?defina COGNITO_CLIENT_NAME}"
CALLBACK_URLS="${COGNITO_CALLBACK_URLS:?defina COGNITO_CALLBACK_URLS}"
OIDC_MOCK_HOST_URL="${OIDC_MOCK_HOST_URL:?defina OIDC_MOCK_HOST_URL}"
OIDC_MOCK_INTERNAL_URL="${OIDC_MOCK_INTERNAL_URL:?defina OIDC_MOCK_INTERNAL_URL}"
HOST_ENDPOINT_URL="${HOST_ENDPOINT_URL:-http://localhost:4566}"

aws() { command aws --endpoint-url "${AWS_ENDPOINT_URL}" "$@"; }

POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 \
  --query "UserPools[?Name=='${POOL_NAME}'].Id | [0]" --output text)

if [ "${POOL_ID}" = 'None' ] || [ -z "${POOL_ID}" ]; then
  echo "Pool '${POOL_NAME}' não existe. Rode: npm run dev:bootstrap" >&2
  exit 1
fi

CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "${POOL_ID}" --max-results 60 \
  --query "UserPoolClients[?ClientName=='${CLIENT_NAME}'].ClientId | [0]" --output text)

REDIRECT_URI="${CALLBACK_URLS%%,*}"

# As URLs que o MiniStack devolve são as do host (é o navegador quem as
# abriria). Daqui de dentro da rede do Compose, os mesmos serviços têm outro
# endereço — só o endereço muda, o caminho e os parâmetros seguem intactos.
inside() {
  local url="$1"
  url="${url/#${OIDC_MOCK_HOST_URL}/${OIDC_MOCK_INTERNAL_URL}}"
  echo "${url/#${HOST_ENDPOINT_URL}/${AWS_ENDPOINT_URL}}"
}

location() { curl -s -o /dev/null -w '%{redirect_url}' "$@"; }

query_param() {
  python3 -c 'import sys, urllib.parse as u; print(u.parse_qs(u.urlparse(sys.argv[1]).query).get(sys.argv[2], [""])[0])' "$1" "$2"
}

fail() {
  echo "$1" >&2
  exit 1
}

AUTHORIZE=$(python3 -c 'import sys, urllib.parse as u; print(u.urlencode({"identity_provider": sys.argv[1], "response_type": "code", "client_id": sys.argv[2], "redirect_uri": sys.argv[3], "scope": "openid email profile", "state": "dev-social-token"}))' \
  "${PROVIDER}" "${CLIENT_ID}" "${REDIRECT_URI}")

IDP_LOGIN=$(location "${AWS_ENDPOINT_URL}/oauth2/authorize?${AUTHORIZE}")
[ -n "${IDP_LOGIN}" ] || fail "O Cognito não redirecionou para o provedor '${PROVIDER}'. Rode: npm run dev:bootstrap"

# O formulário do oidc-mock: o usuário vira o `sub`, e o MiniStack usa um `sub`
# com @ como e-mail da conta.
IDP_RESPONSE=$(location -X POST "$(inside "${IDP_LOGIN}")" \
  --data-urlencode "username=${EMAIL}" \
  --data-urlencode "claims={\"email\":\"${EMAIL}\",\"name\":\"${NAME}\",\"email_verified\":true}")
[ -n "${IDP_RESPONSE}" ] || fail 'O oidc-mock não respondeu. Ele está de pé? docker compose up -d oidc-mock'

APP_CALLBACK=$(location "$(inside "${IDP_RESPONSE}")")
CODE=$(query_param "${APP_CALLBACK}" code)
[ -n "${CODE}" ] || fail "O Cognito não devolveu código: ${APP_CALLBACK}"

curl -s -X POST "${AWS_ENDPOINT_URL}/oauth2/token" \
  --data-urlencode grant_type=authorization_code \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "code=${CODE}" \
  --data-urlencode "redirect_uri=${REDIRECT_URI}" |
  python3 -c 'import json, sys; print(json.load(sys.stdin)["id_token"])'
