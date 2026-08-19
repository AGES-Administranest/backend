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

  const corpoDaResposta = () => json.mock.calls[0][0];

  beforeEach(() => {
    json = jest.fn<void, [Record<string, unknown>]>();
    status = jest.fn().mockReturnValue({ json });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('usa o status que corresponde à natureza do erro de domínio', () => {
    filter.catch(
      new DomainError('NOT_FOUND', 'USUARIO_NAO_ENCONTRADO', 'não encontrado', {
        id: 'abc',
      }),
      host(),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(corpoDaResposta()).toMatchObject({
      code: 'USUARIO_NAO_ENCONTRADO',
      details: { id: 'abc' },
      path: '/users/abc',
    });
  });

  it('devolve erro de validação no mesmo formato dos demais', () => {
    filter.catch(
      new BadRequestException({
        message: ['email must be an email'],
        error: 'Bad Request',
        statusCode: 400,
      }),
      host(),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(corpoDaResposta()).toMatchObject({
      code: 'VALIDACAO_INVALIDA',
      details: { campos: ['email must be an email'] },
    });
  });

  it('não deixa detalhe interno vazar num erro inesperado', () => {
    filter.catch(new Error('connect ECONNREFUSED 10.0.0.1:5432'), host());

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(corpoDaResposta()).toMatchObject({
      code: 'ERRO_INTERNO',
      message: 'Erro interno do servidor',
    });
    expect(JSON.stringify(corpoDaResposta())).not.toContain('ECONNREFUSED');
  });
});
