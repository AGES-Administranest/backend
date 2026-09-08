import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { DomainError } from '../errors/domain-error';

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();
  let json: jest.Mock<void, [Record<string, unknown>]>;
  let status: jest.Mock;

  const host = () =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/users/abc' }),
        getResponse: () => ({ status }),
      }),
    }) as unknown as ArgumentsHost;

  const responseBody = () => json.mock.calls[0][0];

  beforeEach(() => {
    json = jest.fn<void, [Record<string, unknown>]>();
    status = jest.fn().mockReturnValue({ json });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('uses the status matching the domain error kind', () => {
    filter.catch(
      new DomainError('NOT_FOUND', 'USUARIO_NAO_ENCONTRADO', 'not found', {
        id: 'abc',
      }),
      host(),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(responseBody()).toMatchObject({
      code: 'USUARIO_NAO_ENCONTRADO',
      details: { id: 'abc' },
      path: '/users/abc',
    });
  });

  it('returns a validation error in the same shape as every other one', () => {
    filter.catch(
      new BadRequestException({
        message: ['email must be an email'],
        error: 'Bad Request',
        statusCode: 400,
      }),
      host(),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(responseBody()).toMatchObject({
      code: 'VALIDACAO_INVALIDA',
      details: { fields: ['email must be an email'] },
    });
  });

  it('does not leak internal detail on an unexpected error', () => {
    filter.catch(new Error('connect ECONNREFUSED 10.0.0.1:5432'), host());

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(responseBody()).toMatchObject({
      code: 'ERRO_INTERNO',
      message: 'Internal server error',
    });
    expect(JSON.stringify(responseBody())).not.toContain('ECONNREFUSED');
  });
});
