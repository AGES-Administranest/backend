import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { UsersModule } from '../users';

@Module({
  // `auth` never talks to the database: the module that owns the `user` table
  // is the one that touches it (ADR-01). Only orchestration lives here.
  imports: [UsersModule],
  controllers: [AuthController],
})
export class AuthModule {}
