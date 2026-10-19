#!/bin/bash
#
# Builds the API image from the current commit, pushes it to ECR and points
# the App Runner service at it (infra/api.yaml).
#
#   scripts/deploy-api.sh
#
# Needs Docker running and the cognito, storage and database stacks deployed:
# their outputs are read from CloudFormation, not typed in.
#
# Runs on your machine with your own AWS credentials (`aws login`). CI runs the
# same script.

set -euo pipefail

# The PUCRS account only allows us-east-2 (an organization policy denies the
# other regions), so the region is fixed rather than read from the profile.
REGION='us-east-2'
STACK='administranest-prod-api'
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="${ROOT}/infra/api.yaml"

output() {
  aws cloudformation describe-stacks --region "${REGION}" --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

if [ -n "$(git -C "${ROOT}" status --porcelain)" ]; then
  echo 'Uncommitted changes: the image is tagged with the commit, so commit first.' >&2
  exit 1
fi
TAG=$(git -C "${ROOT}" rev-parse --short=12 HEAD)

PARAMS=(
  "CognitoIssuer=$(output administranest-prod-cognito Issuer)"
  "CognitoClientId=$(output administranest-prod-cognito ClientId)"
  "DocumentsBucket=$(output administranest-prod-storage BucketName)"
  "DocumentsPolicyArn=$(output administranest-prod-storage ApiPolicyArn)"
  "DatabaseUrlSecretArn=$(output administranest-prod-database DatabaseUrlSecretArn)"
)

deploy() {
  aws cloudformation deploy \
    --region "${REGION}" \
    --stack-name "${STACK}" \
    --template-file "${TEMPLATE}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --tags project=administranest environment=prod \
    --parameter-overrides "${PARAMS[@]}" "$@"
}

echo '==> 1/3  Repository and roles'
# Keeps the running tag on this pass, so the service doesn't change yet.
CURRENT_TAG=$(aws cloudformation describe-stacks --region "${REGION}" --stack-name "${STACK}" \
  --query "Stacks[0].Parameters[?ParameterKey=='ImageTag'].ParameterValue" --output text 2>/dev/null || true)
[ "${CURRENT_TAG}" = 'None' ] && CURRENT_TAG=''
deploy "ImageTag=${CURRENT_TAG}"
REPOSITORY=$(output "${STACK}" RepositoryUri)

echo "==> 2/3  Image ${TAG}"
aws ecr get-login-password --region "${REGION}" |
  docker login --username AWS --password-stdin "${REPOSITORY%%/*}"
# App Runner runs x86_64; on an Apple Silicon laptop this is emulated.
docker build --platform linux/amd64 -t "${REPOSITORY}:${TAG}" "${ROOT}"
docker push "${REPOSITORY}:${TAG}"

echo '==> 3/3  Service'
deploy "ImageTag=${TAG}"

echo
echo "API: $(output "${STACK}" ServiceUrl)"
