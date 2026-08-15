/**
 * API pública do módulo `users`.
 *
 * Outros módulos importam daqui (`../users`), nunca de dentro
 * (`../users/users.service`) — a regra `no-restricted-imports` em
 * `eslint.config.mjs` bloqueia. Assim dá pra reorganizar os arquivos internos
 * sem quebrar quem depende do módulo.
 */
export { UsersModule } from './users.module';
export { UsersService } from './users.service';
