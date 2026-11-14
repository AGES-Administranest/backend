import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ProfileEntity } from './entities/profile.entity';
import { UserEntity } from './entities/user.entity';
import { UsersService } from './users.service';
import {
  AllowsUnprovisioned,
  CurrentClaims,
  CurrentUser,
} from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser, CognitoIdentity } from '../../shared/auth';
import { DomainError } from '../../shared/errors/domain-error';
import { AccountDeletionService } from '../account-deletion';

const UPDATE_PROFILE_EXAMPLES = {
  full: {
    summary: 'Fill in every editable field',
    value: {
      name: 'Ana Souza',
      crmv: 'RS-12345',
      birthDate: '1990-04-15',
      sex: 'FEMALE',
      city: 'Porto Alegre',
      state: 'RS',
    },
  },
  partial: {
    summary: 'Change one field: the others keep their value',
    value: { city: 'Pelotas' },
  },
  clear: {
    summary: 'Clear fields with null',
    value: { crmv: null, birthDate: null },
  },
};

const UPDATED_PROFILE_EXAMPLE = {
  id: '0b6f8f0e-3c1a-4d2b-9a57-2f1c8e4d6a10',
  name: 'Ana Souza',
  email: 'ana@example.com',
  crmv: 'RS-12345',
  birthDate: '1990-04-15T00:00:00.000Z',
  sex: 'FEMALE',
  city: 'Porto Alegre',
  state: 'RS',
};

const PROFILE_VALIDATION_ERRORS = [
  'name: null, not a string, or outside 2–120 characters after trimming',
  'crmv: not a string, or not UF-number (RS-12345) with a valid UF and up to 6 digits',
  'birthDate: not YYYY-MM-DD, not a real date, before 1900-01-01, or less than 18 years ago',
  'sex: not FEMALE, MALE, OTHER or NOT_INFORMED',
  'city: not a string, blank, or over 120 characters',
  'state: not one of the 27 UF codes',
  'any other field, such as email or cognitoSub',
];

const PROFILE_VALIDATION_ERROR_EXAMPLE = {
  statusCode: 400,
  code: 'VALIDATION_ERROR',
  message: 'Invalid request',
  details: {
    fields: [
      'property email should not exist',
      'name must be longer than or equal to 2 characters',
      'crmv must be the UF and the number, e.g. RS-12345',
      'birthDate must be after 1900 and at least 18 years ago',
      'sex must be one of the following values: FEMALE, MALE, OTHER, NOT_INFORMED',
      'city should not be empty',
      'state must be one of the following values: AC, AL, AM, AP, BA, CE, DF, ES, GO, MA, MG, MS, MT, PA, PB, PE, PI, PR, RJ, RN, RO, RR, RS, SC, SE, SP, TO',
    ],
  },
  path: '/users/me',
  timestamp: '2026-11-09T18:20:41.512Z',
};

/**
 * The owner of DELETE /users/me comes from the token alone (ADR-11). A body or
 * a query string is refused outright, in the same shape the global
 * `ValidationPipe` uses for an unknown property, so a client that tries to name
 * another account (`userId`) learns it was ignored for a reason and not by luck.
 */
function assertNoParameters(source: Record<string, unknown> | undefined): void {
  const names = Object.keys(source ?? {});
  if (names.length === 0) return;

  throw new DomainError(
    'INVALID_INPUT',
    'VALIDATION_ERROR',
    'Invalid request',
    {
      fields: names.map(name => `property ${name} should not exist`),
    },
  );
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountDeletion: AccountDeletionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista todos os usuários' })
  @ApiOkResponse({ type: UserEntity, isArray: true })
  findAll() {
    return this.usersService.findAll();
  }

  // Declared before `:id`, which would otherwise take "me" and fail the UUID pipe.
  @Get('me')
  @ApiOperation({
    summary: "The signed-in user's profile",
    description:
      'The user comes from the token (ADR-11). Fields never filled in come ' +
      'as null; the app calculates the age from birthDate.',
  })
  @ApiOkResponse({ type: ProfileEntity })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description: 'Account deleted while its id was still cached by the guard',
  })
  findMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: "Updates the signed-in user's profile (US24)",
    description:
      'The user comes from the token (ADR-11). Only the fields sent change; ' +
      'null clears a field, except name. E-mail and cognitoSub come from ' +
      'Cognito (ADR-02) and are refused here. Idempotent: the offline queue ' +
      'can resend the same body, so there is no /sync route.',
  })
  @ApiBody({ type: UpdateProfileDto, examples: UPDATE_PROFILE_EXAMPLES })
  @ApiOkResponse({
    type: ProfileEntity,
    description: 'The updated profile, the same body GET /users/me returns',
    example: UPDATED_PROFILE_EXAMPLE,
  })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_ERROR, with one message per failing rule in ' +
      `details.fields. Refused when: ${PROFILE_VALIDATION_ERRORS.join('; ')}`,
    example: PROFILE_VALIDATION_ERROR_EXAMPLE,
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, ' +
      'TOKEN_INVALID), or no local mirror yet (USER_NOT_PROVISIONED)',
  })
  @ApiNotFoundResponse({
    description:
      'Account deleted while its id was still cached by the guard (USER_NOT_FOUND)',
  })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(user.id, dto);
  }

  // Declared before `@Delete(':id')`, which would otherwise take "me".
  //
  // Exempt from the guard's mirror lookup so that asking again after a partial
  // deletion still reaches the service, which finishes it: by then the mirror
  // no longer exists and the guard would answer 401 first.
  @AllowsUnprovisioned()
  @Delete('me')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Deletes the signed-in account and its data (US25, LGPD)',
    description:
      'The account comes from the token (ADR-11); a body or query string, ' +
      'userId included, is refused. Irreversible, so the token must come from ' +
      'a login in the last 5 minutes (auth_time): the app asks for the ' +
      'password again — or runs the Google login again — and sends the new ' +
      'token. Removes every row the user owns in one transaction, then their ' +
      'S3 files, then the Cognito user. Idempotent: repeating it after a ' +
      'complete deletion answers 204, and after a partial one it finishes the ' +
      'job. The app must not call Cognito DeleteUser itself.',
  })
  @ApiNoContentResponse({ description: 'Account deleted' })
  @ApiBadRequestResponse({
    description: 'VALIDATION_ERROR: a body or query parameter was sent',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID); ' +
      'REAUTH_REQUIRED when the login is older than the window — sign in ' +
      'again and resend; USER_NOT_PROVISIONED when the account never existed',
  })
  @ApiInternalServerErrorResponse({
    description:
      'ACCOUNT_DELETION_FAILED: rolled back, nothing was deleted, resend. ' +
      'ACCOUNT_DELETION_INCOMPLETE: the data is gone but the S3 or Cognito ' +
      'step did not finish, resend to finish it',
  })
  async deleteMe(
    @CurrentClaims() identity: CognitoIdentity,
    @Body() body: Record<string, unknown> | undefined,
    @Query() query: Record<string, unknown>,
  ): Promise<void> {
    assertNoParameters(body);
    assertNoParameters(query);
    await this.accountDeletion.deleteAccount(identity);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um usuário pelo id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserEntity })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria um novo usuário' })
  @ApiCreatedResponse({ type: UserEntity })
  @ApiConflictResponse({ description: 'E-mail já cadastrado' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza parcialmente um usuário' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserEntity })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um usuário' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Usuário removido' })
  @ApiNotFoundResponse({ description: 'Usuário não encontrado' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}
