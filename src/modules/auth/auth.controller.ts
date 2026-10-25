import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AcceptTermsDto } from './dto/accept-terms.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordRecoveryGateway } from './password-recovery.gateway';
import { AllowsUnprovisioned, CurrentClaims, Public } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { CognitoIdentity } from '../../shared/auth';
import { UserEntity, UsersService } from '../users';

/**
 * Sign-in and refresh use Cognito directly (client-mobile `features/auth`).
 * Password recovery is exposed here through a replaceable provider.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordRecoveryGateway: PasswordRecoveryGateway,
  ) {}

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Requests a password recovery code',
    description:
      'Returns the same response for registered and unregistered e-mails.',
  })
  @ApiOkResponse({ description: 'Recovery request accepted' })
  @ApiServiceUnavailableResponse({
    description: 'Password recovery integration is not configured',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwordRecoveryGateway.sendRecoveryCode(dto.email);
    return {
      message:
        'If an account exists for this e-mail, a recovery code will be sent.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resets a password with the e-mail recovery code',
  })
  @ApiOkResponse({ description: 'Password reset successfully' })
  @ApiBadRequestResponse({ description: 'Invalid or expired recovery code' })
  @ApiServiceUnavailableResponse({
    description: 'Password recovery integration is not configured',
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordRecoveryGateway.resetPassword(dto);
    return { message: 'Password reset successfully.' };
  }

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
