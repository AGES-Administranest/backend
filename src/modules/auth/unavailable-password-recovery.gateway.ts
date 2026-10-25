import { ServiceUnavailableException } from '@nestjs/common';

import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordRecoveryGateway } from './password-recovery.gateway';

/** Replace this provider when the Cognito recovery integration is available. */
export class UnavailablePasswordRecoveryGateway extends PasswordRecoveryGateway {
  sendRecoveryCode(_email: string): Promise<void> {
    void _email;
    return Promise.reject(
      new ServiceUnavailableException(
        'Password recovery integration is not configured.',
      ),
    );
  }

  resetPassword(_request: ResetPasswordDto): Promise<void> {
    void _request;
    return Promise.reject(
      new ServiceUnavailableException(
        'Password recovery integration is not configured.',
      ),
    );
  }
}
