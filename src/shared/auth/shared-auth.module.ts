import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { loadCognitoConfig } from './auth.config';
import { CognitoJwtVerifier } from './jwt-verifier';
import { SubIdCache } from './sub-id-cache';

/**
 * The pieces the guard is built from — but not the guard.
 *
 * `JwtAuthGuard` needs `AUTH_USER_RESOLVER`, which `UsersModule` provides.
 * Declaring the guard here would mean importing `UsersModule` from `shared/`,
 * which is the dependency direction this whole arrangement exists to avoid.
 * `AppModule` already imports both, so the guard is assembled there instead.
 */
@Module({
  providers: [
    {
      provide: CognitoJwtVerifier,
      useFactory: (config: ConfigService) =>
        new CognitoJwtVerifier(loadCognitoConfig(config)),
      inject: [ConfigService],
    },
    {
      provide: SubIdCache,
      useFactory: (config: ConfigService) => {
        const { subCacheTtlMs, subCacheMaxEntries } = loadCognitoConfig(config);
        return new SubIdCache(subCacheTtlMs, subCacheMaxEntries);
      },
      inject: [ConfigService],
    },
  ],
  exports: [CognitoJwtVerifier, SubIdCache],
})
export class SharedAuthModule {}
