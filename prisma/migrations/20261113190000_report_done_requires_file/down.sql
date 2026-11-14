-- Drops the CHECK. The rows the migration marked FAILED stay FAILED: which of
-- them were DONE before is not recorded.
ALTER TABLE "report" DROP CONSTRAINT "report_done_has_file";
