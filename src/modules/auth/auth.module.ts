import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { PasswordRecoveryGateway } from './password-recovery.gateway';
import { UnavailablePasswordRecoveryGateway } from './unavailable-password-recovery.gateway';
import { AccountDeletionModule } from '../account-deletion';
import { UsersModule } from '../users';

@Module({
  imports: [UsersModule, AccountDeletionModule],
  controllers: [AuthController],
  providers: [
    {
      provide: PasswordRecoveryGateway,
      useClass: UnavailablePasswordRecoveryGateway,
    },
  ],
})
export class AuthModule {}
