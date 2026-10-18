-- Manual reversal of the trip mode and vehicle migration.
ALTER TABLE "trip" DROP CONSTRAINT "trip_cost_per_km_non_negative";
ALTER TABLE "trip" DROP CONSTRAINT "trip_cost_non_negative";
ALTER TABLE "trip" DROP CONSTRAINT "trip_distance_km_positive";
ALTER TABLE "trip" DROP CONSTRAINT "trip_mode_fields";

ALTER TABLE "trip" DROP CONSTRAINT "trip_client_id_fkey";
ALTER TABLE "trip" DROP CONSTRAINT "trip_vehicle_id_fkey";

DROP INDEX "trip_vehicle_id_idx";
DROP INDEX "trip_user_id_client_id_idx";

ALTER TABLE "trip" ALTER COLUMN "cost" DROP NOT NULL,
DROP COLUMN "vehicle_id",
DROP COLUMN "origin",
DROP COLUMN "mode",
DROP COLUMN "destination",
DROP COLUMN "cost_per_km",
DROP COLUMN "client_id";

DROP TYPE "trip_mode_enum";
