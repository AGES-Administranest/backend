import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IdentityProviderGateway } from './identity-provider.gateway';

const DEFAULT_REGION = 'us-east-1';

/**
 * Same code local and in production, only the endpoint changes (ADR-12).
 * Credentials are never read here: the emulator ignores them, and production
 * takes them from the instance role (`cognito-idp:AdminDeleteUser`, see
 * infra/api.yaml).
 */
@Injectable()
export class CognitoIdentityProviderGateway extends IdentityProviderGateway {
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId: string;

  constructor(config: ConfigService) {
    super();

    // Stops the process at startup, like the other COGNITO_* settings: the
    // alternative is discovering it on the first deletion, after the data is
    // already gone.
    const userPoolId = config.get<string>('COGNITO_USER_POOL_ID')?.trim();
    if (!userPoolId) {
      throw new Error(
        'COGNITO_USER_POOL_ID is not set. `npm run dev:bootstrap` writes it ' +
          'into .aws-local.env — see docs/ambiente-local.md.',
      );
    }

    const endpoint = config.get<string>('AWS_ENDPOINT_URL');
    this.userPoolId = userPoolId;
    this.client = new CognitoIdentityProviderClient({
      region: config.get<string>('AWS_REGION') ?? DEFAULT_REGION,
      ...(endpoint ? { endpoint } : {}),
    });
  }

  async deleteUser(username: string): Promise<void> {
    try {
      await this.client.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.userPoolId,
          Username: username,
        }),
      );
    } catch (error) {
      // Already gone — deleted by an earlier attempt, or by the app's own
      // best-effort DeleteUser. Either way the goal is met.
      if (error instanceof UserNotFoundException) return;
      throw error;
    }
  }
}
