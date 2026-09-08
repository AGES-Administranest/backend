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
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';
import { UserEntity, UsersService } from '../users';

/**
 * Sign-in, refresh and password reset do NOT go through here: the app talks to
 * Cognito directly (client-mobile `features/auth`). What is left for the backend
 * is the local mirror.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly usersService: UsersService) {}

  @Post('session')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Creates or refreshes the local mirror of the Cognito user',
    description: 'Idempotent: the app calls it on every login.',
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
