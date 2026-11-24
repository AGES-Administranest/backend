import {
  INestApplication,
  Type,
  ValidationPipe,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '../../../src/shared/filters/all-exceptions.filter';

/** The authenticated user every request of these specs is made as. */
export const USER = {
  id: '0b9f6c1e-7d2a-4f3b-8c5d-1a2b3c4d5e6f',
  cognitoSub: 'sub-1',
  email: 'user@example.com',
};

/** Two ids to put in a path; `describeRoutes` corrupts them in turn. */
export const ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';
export const OTHER_ID = '7c1d9e2f-4b3a-4d5c-8e6f-9a0b1c2d3e4f';

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface Route {
  /** e.g. `GET /client/:id`, with the real ids in place of the parameters. */
  route: `${Uppercase<Verb>} ${string}`;
  body?: object;
  status?: number;
  /** The service method that has to answer, and with which arguments. */
  calls: [service: Type, method: string, ...args: unknown[]];
}

export type ServiceDoubles = Map<Type, Record<string, jest.Mock>>;

/** Every method of `service` as a mock that answers an identifiable body. */
function doubleOf(service: Type): Record<string, jest.Mock> {
  const prototype = service.prototype as object;
  return Object.fromEntries(
    Object.getOwnPropertyNames(prototype)
      .filter(name => name !== 'constructor')
      .map(name => [name, jest.fn().mockResolvedValue({ answeredBy: name })]),
  );
}

class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<{ user: unknown }>().user = USER;
    return true;
  }
}

/**
 * The controllers alone, wired like `src/main.ts`, with their services
 * replaced: what is left to test is the HTTP contract.
 */
export async function createRoutesApp(
  controllers: Type[],
  services: Type[],
): Promise<{ app: INestApplication; doubles: ServiceDoubles }> {
  const doubles: ServiceDoubles = new Map(
    services.map(service => [service, doubleOf(service)]),
  );
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: services.map(service => ({
      provide: service,
      useValue: doubles.get(service),
    })),
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalGuards(new AuthenticatedGuard());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0);

  return { app, doubles };
}

/**
 * For each route: it reaches the right service method as the authenticated
 * user, a malformed id never gets that far, and neither does a body that tries
 * to name another owner (ADR-11).
 */
export function describeRoutes(
  name: string,
  setup: { controllers: Type[]; services: Type[]; routes: Route[] },
): void {
  describe(`${name} routes`, () => {
    let app: INestApplication;
    let doubles: ServiceDoubles;

    beforeAll(async () => {
      ({ app, doubles } = await createRoutesApp(
        setup.controllers,
        setup.services,
      ));
    });
    beforeEach(() => jest.clearAllMocks());
    afterAll(() => app.close());

    const send = (route: string, payload?: object) => {
      const [verb, path] = route.split(' ');
      const call = request(app.getHttpServer() as never)[
        verb.toLowerCase() as Verb
      ](path);
      return payload ? call.send(payload) : call;
    };

    const expectNothingCalled = () => {
      for (const double of doubles.values()) {
        for (const method of Object.values(double)) {
          expect(method).not.toHaveBeenCalled();
        }
      }
    };

    describe.each(setup.routes)('$route', ({ route, body, status, calls }) => {
      const [service, method, ...args] = calls;

      it(`is answered by ${service.name}.${method}`, async () => {
        const expected = status ?? 200;

        const response = await send(route, body);

        expect(response.status).toBe(expected);
        if (expected !== 204) {
          expect(response.body).toEqual({ answeredBy: method });
        }
        const double = doubles.get(service)?.[method];
        expect(double).toHaveBeenCalledTimes(1);
        expect(double?.mock.calls[0]).toEqual(args);
      });

      for (const id of [ID, OTHER_ID].filter(value => route.includes(value))) {
        it(`refuses a malformed id in place of ${id}`, async () => {
          const response = await send(route.replace(id, 'not-a-uuid'), body);

          expect(response.status).toBe(400);
          expectNothingCalled();
        });
      }

      if (body && !Array.isArray(body)) {
        it('refuses a userId in the body', async () => {
          const response = await send(route, { ...body, userId: OTHER_ID });

          expect(response.status).toBe(400);
          expectNothingCalled();
        });
      }
    });
  });
}
