# Migrations

Standard Prisma Migrate flow (`npx prisma migrate dev` / `deploy`). Prisma
applies only `migration.sql` (the "up"); it does **not** have a rollback command.

## `down.sql`

Team convention: every schema-changing migration carries a `down.sql` next to
`migration.sql`, containing the SQL that undoes exactly that migration. It is
used to:

- review the migration's impact by reading its reversal;
- roll back by hand during an incident (`psql < down.sql`);
- prove in review that the change is reversible.

Generated with:

```bash
npx prisma migrate diff \
  --from-schema prisma/schema.prisma \
  --to-schema <previous-state-schema>.prisma \
  --script > prisma/migrations/<mig>/down.sql
```

## Test up + down before opening a PR

Against a throwaway database (not the dev one):

```bash
D=backend_migtest
docker exec backend-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS $D"
docker exec backend-postgres-1 psql -U postgres -c "CREATE DATABASE $D"

# apply every migration up to the new one
for m in prisma/migrations/*/migration.sql; do
  docker exec -i backend-postgres-1 psql -U postgres -d $D -v ON_ERROR_STOP=1 -q < "$m"
done

# revert the last one and reapply it
docker exec -i backend-postgres-1 psql -U postgres -d $D -v ON_ERROR_STOP=1 -q \
  < prisma/migrations/<mig>/down.sql
docker exec -i backend-postgres-1 psql -U postgres -d $D -v ON_ERROR_STOP=1 -q \
  < prisma/migrations/<mig>/migration.sql

docker exec backend-postgres-1 psql -U postgres -c "DROP DATABASE $D"
```

`ON_ERROR_STOP=1` makes the test fail on the first error.
