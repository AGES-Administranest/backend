import { ResetPasswordDto } from './dto/reset-password.dto';

/** Runtime integration token for the password recovery provider. */
export abstract class PasswordRecoveryGateway {
  /** Must resolve identically for known and unknown e-mails. */
  abstract sendRecoveryCode(email: string): Promise<void>;

  /** The provider must validate and consume a one-time, expiring code. */
  abstract resetPassword(request: ResetPasswordDto): Promise<void>;
}