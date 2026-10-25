import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { PasswordRecoveryGateway } from './password-recovery.gateway';
import { UnavailablePasswordRecoveryGateway } from './unavailable-password-recovery.gateway';
import { UsersModule } from '../users';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    {
      provide: PasswordRecoveryGateway,
      useClass: UnavailablePasswordRecoveryGateway,
    },
  ],
})
export class AuthModule {}
