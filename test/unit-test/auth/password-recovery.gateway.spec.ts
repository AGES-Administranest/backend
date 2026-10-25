import { ServiceUnavailableException } from '@nestjs/common';

import { UnavailablePasswordRecoveryGateway } from '../../../src/modules/auth/unavailable-password-recovery.gateway';

describe('UnavailablePasswordRecoveryGateway', () => {
  const gateway = new UnavailablePasswordRecoveryGateway();

  it('does not claim to send a recovery code before integration is configured', async () => {
    await expect(
      gateway.sendRecoveryCode('ana@example.com'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not claim to reset a password before integration is configured', async () => {
    await expect(
      gateway.resetPassword({
        email: 'ana@example.com',
        confirmationCode: '123456',
        newPassword: 'ValidPass@123',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
