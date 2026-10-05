#!/bin/bash
#
# Creates or updates the production document storage stack (infra/storage.yaml)
# and prints the values the backend needs.
#
#   scripts/deploy-storage.sh
#
# A hosted web build that uploads from the browser needs its origin allowed:
#
#   CORS_ALLOWED_ORIGINS=https://app.example.com scripts/deploy-storage.sh
#
# Later runs without it keep the value already in the stack.
#
# Runs on your machine with your own AWS credentials (`aws login`), never in
# the Compose aws-cli container: that one points at MiniStack.

set -euo pipefail

# The PUCRS account only allows us-east-2 (an organization policy denies the
# other regions), so the region is fixed rather than read from the profile.
REGION='us-east-2'
STACK='administranest-prod-storage'
TEMPLATE="$(dirname "$0")/../infra/storage.yaml"

PARAMS=()
if [ -n "${CORS_ALLOWED_ORIGINS:-}" ]; then
  PARAMS+=("CorsAllowedOrigins=${CORS_ALLOWED_ORIGINS}")
fi

aws cloudformation deploy \
  --region "${REGION}" \
  --stack-name "${STACK}" \
  --template-file "${TEMPLATE}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --tags project=administranest environment=prod \
  ${PARAMS[@]+--parameter-overrides "${PARAMS[@]}"}

output() {
  aws cloudformation describe-stacks --region "${REGION}" --stack-name "${STACK}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo
echo '==> Backend (production environment)'
echo "AWS_REGION=${REGION}"
echo "S3_BUCKET=$(output BucketName)"
echo
echo '==> Attach to the API role once it exists'
echo "$(output ApiPolicyArn)"
