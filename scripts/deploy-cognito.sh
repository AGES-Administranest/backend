#!/bin/bash
#
# Creates or updates the production Cognito stack (infra/cognito.yaml) and
# prints the values the backend and the app need.
#
#   scripts/deploy-cognito.sh
#
# Google sign in is turned on by passing the Google Cloud OAuth client once:
#
#   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... scripts/deploy-cognito.sh
#
# Later runs without them keep the values already in the stack.
#
# Runs on your machine with your own AWS credentials (`aws login`), never in
# the Compose aws-cli container: that one points at MiniStack.

set -euo pipefail

# The PUCRS account only allows us-east-2 (an organization policy denies the
# other regions), so the region is fixed rather than read from the profile.
REGION='us-east-2'
STACK='administranest-prod-cognito'
TEMPLATE="$(dirname "$0")/../infra/cognito.yaml"

PARAMS=()
if [ -n "${GOOGLE_CLIENT_ID:-}" ] || [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  : "${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID together with GOOGLE_CLIENT_SECRET}"
  : "${GOOGLE_CLIENT_SECRET:?set GOOGLE_CLIENT_SECRET together with GOOGLE_CLIENT_ID}"
  PARAMS+=("GoogleClientId=${GOOGLE_CLIENT_ID}" "GoogleClientSecret=${GOOGLE_CLIENT_SECRET}")
fi

aws cloudformation deploy \
  --region "${REGION}" \
  --stack-name "${STACK}" \
  --template-file "${TEMPLATE}" \
  --no-fail-on-empty-changeset \
  --tags project=administranest environment=prod \
  ${PARAMS[@]+--parameter-overrides "${PARAMS[@]}"}

output() {
  aws cloudformation describe-stacks --region "${REGION}" --stack-name "${STACK}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

CLIENT_ID=$(output ClientId)

echo
echo '==> Backend (production environment)'
echo "AWS_REGION=${REGION}"
echo "COGNITO_ISSUER=$(output Issuer)"
echo "COGNITO_CLIENT_ID=${CLIENT_ID}"
echo
echo '==> client-mobile .env.prod'
echo "EXPO_PUBLIC_COGNITO_CLIENT_ID=${CLIENT_ID}"
echo 'EXPO_PUBLIC_COGNITO_ENDPOINT='
echo "EXPO_PUBLIC_AWS_REGION=${REGION}"
echo "EXPO_PUBLIC_COGNITO_OAUTH_URL=$(output OAuthUrl)"
echo
echo "==> Google sign in enabled: $(output GoogleEnabled)"
echo "    Authorized redirect URI for the Google OAuth client: $(output GoogleRedirectUri)"
