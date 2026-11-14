import { Module } from '@nestjs/common';

import { AccountDeletionRepository } from './account-deletion.repository';
import { AccountDeletionService } from './account-deletion.service';
import { CognitoIdentityProviderGateway } from './cognito-identity-provider.gateway';
import { IdentityProviderGateway } from './identity-provider.gateway';
import { SharedAuthModule } from '../../shared/auth';

// PrismaModule and StorageModule are global.
@Module({
  imports: [SharedAuthModule],
  providers: [
    AccountDeletionService,
    AccountDeletionRepository,
    {
      provide: IdentityProviderGateway,
      useClass: CognitoIdentityProviderGateway,
    },
  ],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
