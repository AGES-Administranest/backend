import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { AccountDeletionService } from '../../../src/modules/account-deletion';
import { AuthController } from '../../../src/modules/auth/auth.controller';
import { PasswordRecoveryGateway } from '../../../src/modules/auth/password-recovery.gateway';
import { UnavailablePasswordRecoveryGateway } from '../../../src/modules/auth/unavailable-password-recovery.gateway';
import { UsersService } from '../../../src/modules/users';
import { UsersController } from '../../../src/modules/users/users.controller';
import { DomainError } from '../../../src/shared/errors/domain-error';
import { AllExceptionsFilter } from '../../../src/shared/filters/all-exceptions.filter';

/** What the token proves before the local mirror exists: no id. */
const CLAIMS = { cognitoSub: 'sub-1', email: 'user@example.com' };
const ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';

describe('auth and account routes', () => {
  const users = {
    provisionFromCognito: jest.fn(),
    acceptTerms: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    findProfile: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const recovery = { sendRecoveryCode: jest.fn(), resetPassword: jest.fn() };
  const deletion = { assertNotDeleted: jest.fn(), deleteAccount: jest.fn() };
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, UsersController],
      providers: [
        { provide: UsersService, useValue: users },
        { provide: PasswordRecoveryGateway, useValue: recovery },
        { provide: AccountDeletionService, useValue: deletion },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { user: CLAIMS });
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
  });
  beforeEach(() => jest.resetAllMocks());
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer() as never);

  describe('password recovery', () => {
    const reset = {
      email: 'user@example.com',
      confirmationCode: '123456',
      newPassword: 'Str0ng!pass',
    };

    it('asks for a code and never says whether the e-mail exists', async () => {
      const response = await http()
        .post('/auth/forgot-password')
        .send({ email: 'user@example.com' })
        .expect(200);

      expect(recovery.sendRecoveryCode).toHaveBeenCalledWith(
        'user@example.com',
      );
      expect(response.body).toEqual({
        message: expect.stringMatching(/^If an account exists/) as string,
      });
    });

    it('resets the password', async () => {
      await http().post('/auth/reset-password').send(reset).expect(200);

      expect(recovery.resetPassword).toHaveBeenCalledWith(reset);
    });

    it.each([
      'short1!',
      'nouppercase1!',
      'NOLOWER1!',
      'NoDigits!!',
      'N0symbol1',
    ])('refuses the weak password %s', async newPassword => {
      await http()
        .post('/auth/reset-password')
        .send({ ...reset, newPassword })
        .expect(400);

      expect(recovery.resetPassword).not.toHaveBeenCalled();
    });

    it('is unavailable until a provider is configured', async () => {
      const gateway = new UnavailablePasswordRecoveryGateway();

      await expect(
        Promise.resolve().then(() => gateway.sendRecoveryCode('a@b.co')),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        Promise.resolve().then(() => gateway.resetPassword(reset)),
      ).rejects.toBeInstanceOf(Error);
    });
  });

  describe('POST /auth/session', () => {
    it('provisions the mirror from what the token proves', async () => {
      users.provisionFromCognito.mockResolvedValue({ id: ID });

      const response = await http().post('/auth/session').expect(200);

      expect(response.body).toEqual({ id: ID });
      expect(users.provisionFromCognito).toHaveBeenCalledWith(CLAIMS);
    });

    it('does not rebuild the mirror of a deleted account', async () => {
      deletion.assertNotDeleted.mockRejectedValue(
        new DomainError('UNAUTHORIZED', 'ACCOUNT_DELETED', 'deleted'),
      );

      const response = await http().post('/auth/session').expect(401);

      expect(response.body).toMatchObject({ code: 'ACCOUNT_DELETED' });
      expect(users.provisionFromCognito).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/terms', () => {
    it('records the version accepted by the owner of the token', async () => {
      users.acceptTerms.mockResolvedValue({ termsVersion: 'v1' });

      await http()
        .post('/auth/terms')
        .send({ termsVersion: 'v1' })
        .expect(200, { termsVersion: 'v1' });

      expect(users.acceptTerms).toHaveBeenCalledWith('sub-1', 'v1');
    });

    it('requires the version', async () => {
      await http().post('/auth/terms').send({ termsVersion: '' }).expect(400);
    });
  });

  describe('DELETE /users/me', () => {
    it('deletes the account of the token', async () => {
      await http().delete('/users/me').expect(204);

      expect(deletion.deleteAccount).toHaveBeenCalledWith(CLAIMS);
      expect(users.remove).not.toHaveBeenCalled();
    });

    it('refuses to be told whose account to delete', async () => {
      await http().delete('/users/me').send({ userId: ID }).expect(400);
      await http().delete(`/users/me?userId=${ID}`).expect(400);

      expect(deletion.deleteAccount).not.toHaveBeenCalled();
    });
  });

  describe('user records', () => {
    it('routes each request to its service method', async () => {
      const user = { name: 'Ana', email: 'ana@example.com', cognitoSub: 's' };

      await http().get('/users').expect(200);
      await http().get(`/users/${ID}`).expect(200);
      await http().post('/users').send(user).expect(201);
      await http().patch(`/users/${ID}`).send({ name: 'Bia' }).expect(200);
      await http().delete(`/users/${ID}`).expect(204);

      expect(users.findAll).toHaveBeenCalledTimes(1);
      expect(users.findOne).toHaveBeenCalledWith(ID);
      expect(users.create).toHaveBeenCalledWith(user);
      expect(users.update).toHaveBeenCalledWith(ID, { name: 'Bia' });
      expect(users.remove).toHaveBeenCalledWith(ID);
    });

    it('refuses a malformed id', async () => {
      await http().get('/users/not-a-uuid').expect(400);

      expect(users.findOne).not.toHaveBeenCalled();
    });

    it('needs a local mirror to answer the profile', async () => {
      const response = await http().get('/users/me').expect(401);

      expect(response.body).toMatchObject({ code: 'USER_NOT_PROVISIONED' });
    });
  });
});
