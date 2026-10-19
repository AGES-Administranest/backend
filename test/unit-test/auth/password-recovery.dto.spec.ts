import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ForgotPasswordDto } from '../../../src/modules/auth/dto/forgot-password.dto';
import { ResetPasswordDto } from '../../../src/modules/auth/dto/reset-password.dto';

describe('password recovery DTOs', () => {
  it('requires a valid e-mail to request recovery', async () => {
    const dto = plainToInstance(ForgotPasswordDto, { email: 'not-an-email' });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each(['short', 'lowercase1!', 'UPPERCASE1!', 'NoNumber@', 'ValidPass123'])(
    'rejects a password outside the Cognito policy: %s',
    async newPassword => {
      const dto = plainToInstance(ResetPasswordDto, {
        email: 'ana@example.com',
        confirmationCode: '123456',
        newPassword,
      });

      expect(await validate(dto)).not.toHaveLength(0);
    },
  );

  it('accepts a password matching the Cognito policy', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      email: 'ana@example.com',
      confirmationCode: '123456',
      newPassword: 'ValidPass@123',
    });

    expect(await validate(dto)).toHaveLength(0);
  });
});