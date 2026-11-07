-- US23: profile fields the app shows on the Profile tab. All three are
-- nullable with no default, so existing users keep NULL until they fill them
-- in; the app renders NULL as "Not informed".

-- CreateEnum
CREATE TYPE "sex_enum" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'NOT_INFORMED');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "city" VARCHAR(120),
ADD COLUMN     "sex" "sex_enum",
ADD COLUMN     "state" VARCHAR(2);
