import { Module } from '@nestjs/common';

import { CognitoUserResolver } from './cognito-user-resolver';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { AUTH_USER_RESOLVER } from '../../shared/auth/auth-user-resolver';

@Module({
  controllers: [UsersController],
  // O repository é provider do módulo, mas não entra em `exports`:
  // fora daqui, o único caminho para os dados de usuário é o UsersService.
  providers: [
    UsersService,
    UsersRepository,
    CognitoUserResolver,
    // The guard asks for the interface, not for this module. Exporting the
    // token is what lets `shared/auth` stay unaware that `users` exists.
    { provide: AUTH_USER_RESOLVER, useExisting: CognitoUserResolver },
  ],
  exports: [UsersService, AUTH_USER_RESOLVER],
})
export class UsersModule {}
