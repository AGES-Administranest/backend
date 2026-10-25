-- DropForeignKey
ALTER TABLE "extraction_job" DROP CONSTRAINT "extraction_job_purchase_invoice_id_fkey";

-- DropTable
DROP TABLE "extraction_job";

-- DropEnum
DROP TYPE "extraction_job_status_enum";
