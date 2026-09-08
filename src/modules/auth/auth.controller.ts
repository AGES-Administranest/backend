import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AcceptTermsDto } from './dto/accept-terms.dto';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata`: a type used in the
// signature of a decorated method cannot arrive through a value import.
import type { AuthenticatedUser } from '../../shared/auth';
import { UserEntity, UsersService } from '../users';

/**
 * The account lifecycle as far as the backend is concerned.
 *
 * Sign-up, sign-in, refresh and password reset do NOT go through here: the app
 * talks to Cognito directly (see `features/auth` in client-mobile). What is
 * left for the backend is the local mirror — creating it and recording consent.
 *
 * There is no `AuthService`: neither route has a rule of its own. The rules are
 * about the `user` table, so they live in `UsersService`, which owns it
 * (ADR-01).
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly usersService: UsersService) {}

  @Post('session')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Creates or refreshes the local mirror of the Cognito user',
    description:
      'Idempotent: the app calls it on every login. 200 rather than 201 ' +
      'precisely because the ordinary call is the one that creates nothing.',
  })
  @ApiOkResponse({ type: UserEntity })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiConflictResponse({
    description: 'E-mail already belongs to another account',
  })
  session(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.provisionFromCognito(user);
  }

  @Post('terms')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Records consent to the terms of use and the privacy policy',
    description: 'Stores the date and the version of the accepted text.',
  })
  @ApiOkResponse({ type: UserEntity })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({ description: 'Local mirror not provisioned yet' })
  acceptTerms(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptTermsDto,
  ) {
    return this.usersService.acceptTerms(user.cognitoSub, dto.termsVersion);
  }
}
