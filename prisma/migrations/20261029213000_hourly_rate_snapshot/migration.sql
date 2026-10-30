-- US22: the hour value of each month as it was calculated, with its parts and
-- the US19 goals it used. GET /pricing/hourly-rate (US20) recalculates any
-- month from the current pricing_settings, so without this table a change to
-- the income goal or the weekly hours would rewrite every past month.
--
-- Every column is NOT NULL: a month is only calculated once the three goals are
-- configured (404 PRICING_SETTINGS_NOT_FOUND otherwise), so a snapshot always
-- has all of them.

-- CreateTable
CREATE TABLE "hourly_rate_snapshot" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "hourly_rate" DECIMAL(14,2) NOT NULL,
    "fixed_costs" DECIMAL(14,2) NOT NULL,
    "variable_costs" DECIMAL(14,2) NOT NULL,
    "owner_draw" DECIMAL(14,2) NOT NULL,
    "safety_margin" DECIMAL(14,2) NOT NULL,
    "monthly_income_goal" DECIMAL(14,2) NOT NULL,
    "weekly_hours" DECIMAL(6,2) NOT NULL,
    "safety_margin_pct" DECIMAL(6,2) NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hourly_rate_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hourly_rate_snapshot_user_id_year_month_key" ON "hourly_rate_snapshot"("user_id", "year", "month");

-- AddForeignKey
ALTER TABLE "hourly_rate_snapshot" ADD CONSTRAINT "hourly_rate_snapshot_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The period, with the same range the month filter of GET
-- /pricing/hourly-rate accepts.
ALTER TABLE "hourly_rate_snapshot"
  ADD CONSTRAINT "hourly_rate_snapshot_period_range"
  CHECK ("year" BETWEEN 2000 AND 2100 AND "month" BETWEEN 1 AND 12);

-- The parts are amounts in R$ and none of them is ever negative: expenses are
-- stored positive, depreciation and transport are >= 0, the goal is > 0 and
-- the margin is a percentage of those. Zero is valid: a month with no
-- expenses, or a margin of 0%. The hour value divides a non-negative total by
-- positive hours, so it is never negative either.
ALTER TABLE "hourly_rate_snapshot"
  ADD CONSTRAINT "hourly_rate_snapshot_amounts_non_negative"
  CHECK (
    "hourly_rate" >= 0
    AND "fixed_costs" >= 0
    AND "variable_costs" >= 0
    AND "owner_draw" >= 0
    AND "safety_margin" >= 0
  );

-- The goals used are copies of pricing_settings, so they follow the same
-- rules as there (migration 20261012190000_pricing_settings_constraints).
-- Unlike there they are NOT NULL, so each rule always applies.
ALTER TABLE "hourly_rate_snapshot"
  ADD CONSTRAINT "hourly_rate_snapshot_monthly_income_goal_positive"
  CHECK ("monthly_income_goal" > 0);

ALTER TABLE "hourly_rate_snapshot"
  ADD CONSTRAINT "hourly_rate_snapshot_weekly_hours_range"
  CHECK ("weekly_hours" > 0 AND "weekly_hours" <= 168);

ALTER TABLE "hourly_rate_snapshot"
  ADD CONSTRAINT "hourly_rate_snapshot_safety_margin_pct_range"
  CHECK ("safety_margin_pct" >= 0 AND "safety_margin_pct" <= 100);
