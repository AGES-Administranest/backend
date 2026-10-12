-- US19: the rules of the billable-hour settings, enforced by the database as
-- well as by the DTO. A row that breaks them would reach the hour calculation
-- (US20) as a division by zero or a negative price.
--
-- Every column stays nullable: a row can exist with only the transport cost
-- (US18) and none of the US19 goals. A CHECK on a NULL column passes, so each
-- rule below only bites once the value is filled in.

-- A goal of zero or less makes no sense as income to aim for.
ALTER TABLE "pricing_settings"
  ADD CONSTRAINT "pricing_settings_monthly_income_goal_positive"
  CHECK ("monthly_income_goal" > 0);

-- The hour value divides by the weekly hours, so zero is never allowed; a week
-- has 168 hours, so anything above that is a typo.
ALTER TABLE "pricing_settings"
  ADD CONSTRAINT "pricing_settings_weekly_hours_range"
  CHECK ("weekly_hours" > 0 AND "weekly_hours" <= 168);

ALTER TABLE "pricing_settings"
  ADD CONSTRAINT "pricing_settings_safety_margin_pct_range"
  CHECK ("safety_margin_pct" >= 0 AND "safety_margin_pct" <= 100);

-- Zero is valid: a professional who does not drive has no transport cost.
ALTER TABLE "pricing_settings"
  ADD CONSTRAINT "pricing_settings_transport_cost_monthly_non_negative"
  CHECK ("transport_cost_monthly" >= 0);

-- The three US19 goals are saved together, so they are either all filled in
-- (the settings are "configured") or all empty. A half-configured row would
-- otherwise be read differently by each screen.
ALTER TABLE "pricing_settings"
  ADD CONSTRAINT "pricing_settings_goals_together"
  CHECK (
    ("monthly_income_goal" IS NULL) = ("weekly_hours" IS NULL)
    AND ("weekly_hours" IS NULL) = ("safety_margin_pct" IS NULL)
  );
