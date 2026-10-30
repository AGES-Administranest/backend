-- Manual reversal of migration 20261029213000_hourly_rate_snapshot.
-- Prisma Migrate does not run this file automatically; see
-- prisma/migrations/README.md for the test procedure (up + down).
--
-- Destroys the whole hourly rate history: disposable environments only. The
-- CHECKs, the unique index and the foreign key go with the table.

DROP TABLE "hourly_rate_snapshot";
