import { Sex } from '@prisma/client';

/**
 * What the Profile tab shows (US23). Only the fields the user fills in about
 * themselves: no `cognitoSub`, `taxId` or consent data.
 */
export class ProfileEntity {
  /** Local id of the user */
  id!: string;

  /** Full name */
  name!: string;

  /** E-mail, mirrored from Cognito */
  email!: string;

  /** Council registration. Null = not filled in; needed for reports (US28) */
  crmv!: string | null;

  /** The app calculates the age from it */
  birthDate!: Date | null;

  /** Null = not filled in; NOT_INFORMED is the user's explicit choice */
  sex!: Sex | null;

  /** City where the professional works */
  city!: string | null;

  /** State (UF), two-letter code */
  state!: string | null;
}
