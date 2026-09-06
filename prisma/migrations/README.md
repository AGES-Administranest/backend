# Migrations

Fluxo padrão do Prisma Migrate (`npx prisma migrate dev` / `deploy`). O Prisma
aplica apenas `migration.sql` (o "up"); ele **não** tem comando de rollback.

## `down.sql`

Convenção do time: toda migration que altera schema carrega um `down.sql` ao lado
do `migration.sql`, com o SQL que desfaz exatamente aquela migration. Ele serve
para:

- revisar o impacto da migration lendo a reversão;
- reverter à mão em incidente (`psql < down.sql`);
- provar em revisão que a mudança é reversível.

Gerado com:

```bash
npx prisma migrate diff \
  --from-schema prisma/schema.prisma \
  --to-schema <schema-do-estado-anterior>.prisma \
  --script > prisma/migrations/<mig>/down.sql
```

## Testar up + down antes de abrir PR

Contra um banco descartável (não o de dev):

```bash
D=backend_migtest
docker exec backend-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS $D"
docker exec backend-postgres-1 psql -U postgres -c "CREATE DATABASE $D"

# aplica todas as migrations até a nova
for m in prisma/migrations/*/migration.sql; do
  docker exec -i backend-postgres-1 psql -U postgres -d $D -v ON_ERROR_STOP=1 -q < "$m"
done

# reverte a última e reaplica
docker exec -i backend-postgres-1 psql -U postgres -d $D -v ON_ERROR_STOP=1 -q \
  < prisma/migrations/<mig>/down.sql
docker exec -i backend-postgres-1 psql -U postgres -d $D -v ON_ERROR_STOP=1 -q \
  < prisma/migrations/<mig>/migration.sql

docker exec backend-postgres-1 psql -U postgres -c "DROP DATABASE $D"
```

`ON_ERROR_STOP=1` faz o teste falhar no primeiro erro.
