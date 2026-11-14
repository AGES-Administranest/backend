-- US32: a DONE report has its file: the key, the name and the size. Every row
-- is written by ReportArchiveService.store, which sets the three when it
-- creates the row, so the history never lists a report it cannot download or
-- name.
--
-- The PDF recording of US28 (#92) wrote rows DONE without a name or a size
-- before it moved to that cycle. They are marked FAILED first: they leave the
-- history (the file stays in the bucket) and the CHECK holds for every row,
-- not only for new ones as a NOT VALID constraint would.
UPDATE "report"
SET "status" = 'FAILED'
WHERE "status" = 'DONE'
  AND ("file_url" IS NULL OR "file_name" IS NULL OR "file_bytes_size" IS NULL);

-- AddCheckConstraint
ALTER TABLE "report"
  ADD CONSTRAINT "report_done_has_file" CHECK (
    "status" <> 'DONE'
    OR ("file_url" IS NOT NULL AND "file_name" IS NOT NULL AND "file_bytes_size" IS NOT NULL)
  );
