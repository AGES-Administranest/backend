-- US14: a trip gets a mode, a route and, by car, the vehicle it was priced
-- from. OWN_VEHICLE copies the vehicle's cost per km into cost_per_km, so a
-- later fuel price change does not reprice old trips; RIDE stores the fare.
--
-- mode, origin and destination are NOT NULL without a default, and cost
-- becomes NOT NULL: no code has ever written to trip and no shared
-- environment holds rows, so a non-empty table should stop this migration
-- rather than receive an invented mode.

-- CreateEnum
CREATE TYPE "trip_mode_enum" AS ENUM ('OWN_VEHICLE', 'RIDE');

-- AlterTable
ALTER TABLE "trip" ADD COLUMN     "client_id" UUID,
ADD COLUMN     "cost_per_km" DECIMAL(10,4),
ADD COLUMN     "destination" VARCHAR(200) NOT NULL,
ADD COLUMN     "mode" "trip_mode_enum" NOT NULL,
ADD COLUMN     "origin" VARCHAR(200) NOT NULL,
ADD COLUMN     "vehicle_id" UUID,
ALTER COLUMN "cost" SET NOT NULL;

-- CreateIndex
CREATE INDEX "trip_user_id_client_id_idx" ON "trip"("user_id", "client_id");

-- CreateIndex
CREATE INDEX "trip_vehicle_id_idx" ON "trip"("vehicle_id");

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The fields each mode needs, enforced by the database as well as by the API.
-- OWN_VEHICLE is priced from a vehicle and a distance; RIDE has neither a
-- vehicle nor a cost per km, and its distance is optional.
ALTER TABLE "trip"
  ADD CONSTRAINT "trip_mode_fields"
  CHECK (
    CASE "mode"
      WHEN 'OWN_VEHICLE' THEN
        "vehicle_id" IS NOT NULL
        AND "distance_km" IS NOT NULL
        AND "cost_per_km" IS NOT NULL
      WHEN 'RIDE' THEN
        "vehicle_id" IS NULL
        AND "cost_per_km" IS NULL
      ELSE FALSE
    END
  );

ALTER TABLE "trip"
  ADD CONSTRAINT "trip_distance_km_positive"
  CHECK ("distance_km" > 0);

-- Zero is valid: a very short trip by car can round to 0.00, and the vehicle
-- caps allow a cost per km that rounds to 0.0000.
ALTER TABLE "trip"
  ADD CONSTRAINT "trip_cost_non_negative"
  CHECK ("cost" >= 0);

ALTER TABLE "trip"
  ADD CONSTRAINT "trip_cost_per_km_non_negative"
  CHECK ("cost_per_km" >= 0);
