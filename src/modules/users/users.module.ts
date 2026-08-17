import { Module } from '@nestjs/common';

import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  // O repository é provider do módulo, mas não entra em `exports`:
  // fora daqui, o único caminho para os dados de usuário é o UsersService.
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
