-- US13: the user's vehicle, with the average consumption (km/L) and the fuel
-- price (R$/L) the cost per kilometre is calculated from. That cost is not
-- stored. The link from trip to vehicle comes with US14.

-- CreateEnum
CREATE TYPE "fuel_type_enum" AS ENUM ('GASOLINE', 'ETHANOL', 'FLEX', 'DIESEL');

-- CreateTable
CREATE TABLE "vehicle" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "brand" VARCHAR(60) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "fuel_type" "fuel_type_enum" NOT NULL,
    "avg_consumption_km_l" DECIMAL(6,2) NOT NULL,
    "fuel_price" DECIMAL(10,3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_user_id_active_idx" ON "vehicle"("user_id", "active");

-- AddForeignKey
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
