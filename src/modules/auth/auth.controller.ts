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
import { AllowsUnprovisioned, CurrentClaims } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { CognitoIdentity } from '../../shared/auth';
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

  // The endpoint that creates the mirror, so it cannot require one to exist.
  @AllowsUnprovisioned()
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
  session(@CurrentClaims() claims: CognitoIdentity) {
    return this.usersService.provisionFromCognito(claims);
  }

  // Also exempt, so that calling it before the mirror exists keeps answering
  // 404 USER_NOT_PROVISIONED from the service. Letting the guard reject it
  // first would turn the same mistake into a 401 and say less about the cause.
  @AllowsUnprovisioned()
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
    @CurrentClaims() claims: CognitoIdentity,
    @Body() dto: AcceptTermsDto,
  ) {
    return this.usersService.acceptTerms(claims.cognitoSub, dto.termsVersion);
  }
}
