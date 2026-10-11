-- Manual reversal of migration 20261007162037_create_vehicle.
-- Prisma Migrate does not run this file automatically; see
-- prisma/migrations/README.md for the test procedure (up + down).
--
-- Destroys every registered vehicle: disposable environments only.

DROP TABLE "vehicle";
DROP TYPE "fuel_type_enum";
