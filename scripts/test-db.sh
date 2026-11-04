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
WALK_DB="${TEST_DB}_walk"
# Migrations that only rewrite rows already in the table. Step 3 runs on an empty
# database, so their down.sql has nothing to undo there; it still has to run.
BACKFILLS=(20260930120000_stock_opening_balance)
PG_SERVICE='postgres'
PG_USER='postgres'
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${TEST_DB}?schema=public"

cd "$(dirname "$0")/.."

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

psql_root() {
  docker compose exec -T "${PG_SERVICE}" psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d postgres "$@"
}
psql_walk() {
  docker compose exec -T "${PG_SERVICE}" psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d "${WALK_DB}" "$@"
}
# `\restrict` lines carry a random token, so two dumps would never compare equal.
dump() {
  docker compose exec -T "${PG_SERVICE}" pg_dump -U "${PG_USER}" -d "$1" \
    --no-owner --exclude-table=_prisma_migrations "${@:2}" |
    grep -v '^\\\(un\)\?restrict'
}
schema_dump() { dump "$1" --schema-only; }
is_backfill() { printf '%s\n' "${BACKFILLS[@]}" | grep -qx "$1"; }

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
# A down.sql undoes its migration from the state right after it: later
# migrations may depend on what it drops. So each one runs at that point, in a
# single pass over a second database, and is judged by pg_dump rather than by
# schema.prisma, which only describes the final state and misses CHECKs. Undoing
# is checked with the data too, since a seed migration changes nothing else;
# re-applying only with the schema, since a seed gets new ids and timestamps.
psql_root -c "DROP DATABASE IF EXISTS ${WALK_DB} WITH (FORCE)" >/dev/null
psql_root -c "CREATE DATABASE ${WALK_DB}" >/dev/null

for up in $(find prisma/migrations -name migration.sql | sort); do
  down="$(dirname "${up}")/down.sql"
  migration=$(basename "$(dirname "${up}")")

  # Piped through stdin: the postgres container does not mount the repo.
  psql_walk -q <"${up}" >/dev/null || fail "${migration} failed to apply"
  [ -f "${down}" ] || continue

  printf '    %s ... ' "${migration}"
  applied=$(dump "${WALK_DB}")
  applied_schema=$(schema_dump "${WALK_DB}")
  psql_walk -q <"${down}" >/dev/null || fail "down.sql failed for ${migration}"
  is_backfill "${migration}" || [ "$(dump "${WALK_DB}")" != "${applied}" ] ||
    fail "down.sql for ${migration} changed nothing — it does not reverse the migration"
  psql_walk -q <"${up}" >/dev/null ||
    fail "re-applying ${migration} after its down.sql failed"
  [ "$(schema_dump "${WALK_DB}")" = "${applied_schema}" ] ||
    fail "down.sql for ${migration} left something behind — re-applying gave a different schema"
  if is_backfill "${migration}"; then
    echo 'ran and re-applied (backfill: no rows to undo here)'
  else
    echo 'reversed and re-applied'
  fi
done

[ "$(schema_dump "${WALK_DB}")" = "$(schema_dump "${TEST_DB}")" ] ||
  fail 'after the up/down/up cycle the schema no longer matches the migrated database'
psql_root -c "DROP DATABASE ${WALK_DB}" >/dev/null
echo '    schema restored'

step '4/4  e2e suite'
npx jest --config ./test/jest-e2e.json --runInBand "$@"

printf '\n\033[32m==================== all green ====================\033[0m\n'
