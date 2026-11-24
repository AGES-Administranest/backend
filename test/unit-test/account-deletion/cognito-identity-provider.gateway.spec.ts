import {
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { ConfigService } from '@nestjs/config';

import { CognitoIdentityProviderGateway } from '../../../src/modules/account-deletion/cognito-identity-provider.gateway';

const gatewayWith = (settings: Record<string, string>) =>
  new CognitoIdentityProviderGateway({
    get: (name: string) => settings[name],
  } as unknown as ConfigService);

describe('CognitoIdentityProviderGateway', () => {
  let send: jest.SpyInstance;

  beforeEach(() => {
    send = jest
      .spyOn(CognitoIdentityProviderClient.prototype, 'send')
      .mockResolvedValue({} as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, '   '])(
    'refuses to start without a user pool (%p)',
    poolId => {
      expect(() =>
        gatewayWith(
          poolId === undefined ? {} : { COGNITO_USER_POOL_ID: poolId },
        ),
      ).toThrow('COGNITO_USER_POOL_ID is not set');
    },
  );

  it('deletes the user from the configured pool', async () => {
    const gateway = gatewayWith({
      COGNITO_USER_POOL_ID: ' pool-1 ',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_REGION: 'sa-east-1',
    });

    await gateway.deleteUser('username-1');

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { UserPoolId: 'pool-1', Username: 'username-1' },
      }),
    );
  });

  it('treats a user that is already gone as deleted', async () => {
    send.mockRejectedValue(
      new UserNotFoundException({ message: 'gone', $metadata: {} }),
    );

    await expect(
      gatewayWith({ COGNITO_USER_POOL_ID: 'pool-1' }).deleteUser('username-1'),
    ).resolves.toBeUndefined();
  });

  it('reports any other failure', async () => {
    send.mockRejectedValue(new Error('throttled'));

    await expect(
      gatewayWith({ COGNITO_USER_POOL_ID: 'pool-1' }).deleteUser('username-1'),
    ).rejects.toThrow('throttled');
  });
});
