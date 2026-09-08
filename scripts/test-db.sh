#!/usr/bin/env bash
#
# Everything that needs a real database:
#
#   npm run test:db
#
# It works on a throwaway database (backend_test) inside the Compose Postgres,
# so your development data is never touched. Each run drops and recreates it.
#
# Four things are checked, in order:
#   1. every migration applies from an empty database
#   2. schema.prisma and the migrations agree (a schema edit with no migration
#      fails here, instead of on someone else's machine)
#   3. each down.sql actually reverses its migration
#   4. the e2e suite passes against the resulting schema

set -euo pipefail

TEST_DB="${TEST_DB:-backend_test}"
PG_SERVICE='postgres'
PG_USER='postgres'
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${TEST_DB}?schema=public"

cd "$(dirname "$0")/.."

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

psql_root() {
  docker compose exec -T "${PG_SERVICE}" psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d postgres "$@"
}
psql_test() {
  docker compose exec -T "${PG_SERVICE}" psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d "${TEST_DB}" "$@"
}

docker info >/dev/null 2>&1 || fail 'Docker is not running. Start it and try again.'

step 'Postgres'
docker compose up -d "${PG_SERVICE}" >/dev/null
for _ in $(seq 1 30); do
  if docker compose exec -T "${PG_SERVICE}" pg_isready -U "${PG_USER}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker compose exec -T "${PG_SERVICE}" pg_isready -U "${PG_USER}" >/dev/null 2>&1 ||
  fail 'Postgres did not become ready.'
echo "    ready"

step "Recreating ${TEST_DB}"
# FORCE drops the database even with connections still open — a previous run
# interrupted halfway would otherwise block this one.
psql_root -c "DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)" >/dev/null
psql_root -c "CREATE DATABASE ${TEST_DB}" >/dev/null
echo "    empty"

step '1/4  Applying every migration'
npx prisma migrate deploy

# Compares the live test database against schema.prisma.
# --exit-code makes it 0 when identical and 2 when they differ; anything else is
# the CLI itself failing, which must not be reported as a schema difference.
# The datasource comes from prisma.config.ts, which reads DATABASE_URL — exported
# above, so it points at the throwaway database.
schema_matches_database() {
  npx prisma migrate diff \
    --from-config-datasource \
    --to-schema prisma/schema.prisma \
    --exit-code >/dev/null 2>&1
  case $? in
    0) return 0 ;;
    2) return 1 ;;
    *) fail 'prisma migrate diff failed to run' ;;
  esac
}

step '2/4  schema.prisma vs. migrations'
if ! schema_matches_database; then
  npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script || true
  fail 'schema.prisma does not match the migrations. Run: npx prisma migrate dev'
fi
echo '    in sync'

step '3/4  Reversibility of the down.sql files'
DOWN_MIGRATIONS=$(find prisma/migrations -name down.sql | sort -r)
if [ -z "${DOWN_MIGRATIONS}" ]; then
  echo '    none shipped yet — skipping'
else
  for down in ${DOWN_MIGRATIONS}; do
    migration=$(basename "$(dirname "${down}")")
    printf '    %s ... ' "${migration}"
    # Piped through stdin: the postgres container does not mount the repo.
    psql_test -q <"${down}" >/dev/null ||
      fail "down.sql failed for ${migration}"
    # After undoing it, the database must now DIFFER from schema.prisma. If it
    # still matches, the down.sql ran without actually undoing anything.
    if schema_matches_database; then
      fail "down.sql for ${migration} changed nothing — it does not reverse the migration"
    fi
    psql_test -q <"$(dirname "${down}")/migration.sql" >/dev/null ||
      fail "re-applying ${migration} after its down.sql failed"
    echo 'reversed and re-applied'
  done

  schema_matches_database ||
    fail 'after the up/down/up cycle the schema no longer matches schema.prisma'
  echo '    schema restored'
fi

step '4/4  e2e suite'
npx jest --config ./test/jest-e2e.json --runInBand "$@"

printf '\n\033[32m==================== all green ====================\033[0m\n'
