# ADR-13 — Login com Google pelo Cognito

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** Hoje o app autentica só por e-mail e senha, falando direto com a API do Cognito (`USER_PASSWORD_AUTH`), e o backend valida o IdToken e mantém o espelho local (ADR-02, ADR-11). O time quer oferecer "Continuar com Google". Duas restrições moldam o desenho: o app é um cliente público (não guarda segredo) e todo desenvolvimento precisa rodar sem conta AWS (ADR-12).

**Opções:** (a) federação no Cognito — Google cadastrado como provedor do user pool, o app faz Authorization Code + PKCE no domínio do pool; (b) SDK nativo do Google no app, e o backend valida também os tokens do Google; (c) Cognito Identity Pools com os tokens dos provedores.

**Decisão:** (a). O Cognito continua sendo o único emissor de token que o backend conhece: uma conta do Google vira um usuário do pool, com `sub` próprio, e o IdToken tem o mesmo `iss`, `aud` e chave de assinatura de uma conta com senha. **O guard, o espelho e o isolamento não mudam** — verificado: token federado passa em `POST /auth/session`, cria o espelho e acessa `/item` e `/supplier`. (b) obrigaria o backend a validar dois emissores e o app a manter dois fluxos de sessão; (c) entrega credenciais AWS, não o token que a API espera.

**Fluxo:**

```
app ── /oauth2/authorize?identity_provider=Google&code_challenge=… ──► domínio do pool
                                                                         │ redirect
                                          Google (login) ◄───────────────┘
                                                                         │
app ◄── administranest://auth/callback?code=… ◄── /oauth2/idpresponse ◄──┘
app ── POST /oauth2/token (code + code_verifier) ──► id/access/refresh token
app ── POST /auth/session (Bearer IdToken) ──► backend: espelho (ADR-02)
```

Depois do login, a sessão é a mesma de uma conta com senha: refresh por `InitiateAuth REFRESH_TOKEN_AUTH` e logout por `RevokeToken`, os dois já usados pelo app. O fluxo `implicit` fica desligado — ele devolveria o token na URL.

**Configuração do app client:** `SupportedIdentityProviders = COGNITO, Google`; `AllowedOAuthFlows = code`; escopos `openid email profile`; `CallbackURLs`/`LogoutURLs` com o scheme do app (`administranest://auth/callback`) e, fora de produção, os endereços do Expo Go e do Expo web. O `redirect_uri` enviado pelo app precisa bater **exatamente** com um da lista.

**Emulação local (MiniStack, ADR-12):** o `dev:bootstrap` cria o domínio, o provedor e a configuração OAuth do client. Divergências verificadas no MiniStack 1.3.59:

1. **Não há o tipo `Google`, só OIDC genérico.** Ele é registrado como OIDC **com esse nome**, apontando para o `oidc-mock` (`mock-oauth2-server`) do Compose. O app manda `identity_provider=Google` igual em produção; só a tela de login é falsa.
2. **PKCE não é conferido no login federado.** O `code_verifier` é ignorado; na AWS é obrigatório. Código que esquecer o PKCE passa em local e falha em produção.
3. **O IdToken federado não traz o claim `identities`** e `email_verified` vem como string `"True"`. Nada no backend depende de nenhum dos dois hoje; se passar a depender, testar na AWS.
4. **Refresh pelo `/oauth2/token` (`grant_type=refresh_token`) falha** para conta federada. O `InitiateAuth REFRESH_TOKEN_AUTH`, que é o que o app usa, funciona.
5. **Sem gatilhos Lambda de sign-up** (Pre sign-up), o que pesa na decisão abaixo.

`npm run dev:social-token` percorre o fluxo inteiro por HTTP e imprime um IdToken de conta social, para testar a API sem o app.

**Ponto em aberto — mesma pessoa, duas contas:** quem se cadastrou com senha como `ana@gmail.com` e depois toca em "Entrar com Google" com o mesmo e-mail vira **outro usuário no Cognito, com outro `sub`**. O espelho tem e-mail único, então `POST /auth/session` responde `409 USER_EMAIL_ALREADY_REGISTERED` (verificado). O caminho inverso dá o mesmo resultado. Opções:

- (i) **Não vincular:** o app trata o 409 dizendo "este e-mail já tem conta — entre com senha" (ou "com Google"). Zero infraestrutura, funciona igual em local e em produção. Custo: a pessoa escolhe um jeito de entrar e fica nele.
- (ii) **Vincular no Cognito com gatilho Pre sign-up:** uma Lambda chama `AdminLinkProviderForUser` quando o e-mail já existe, e o login social passa a cair no mesmo `sub`. É o caminho que a AWS recomenda. Custo: Lambda e permissão IAM sem IaC no projeto, não emulável localmente, e só é seguro vincular com e-mail verificado pelo provedor.
- (iii) **Vincular no backend:** o espelho passa a aceitar vários `sub` por usuário. Custo: muda o modelo do ADR-02 e o cache `sub → id` do guard, e traz para o backend a decisão de confiar no e-mail de um terceiro.

Recomendação: **(i) agora, (ii) quando houver infraestrutura como código** — (i) não fecha a porta para (ii), e (iii) mistura responsabilidade de identidade no backend.

**Termos de uso (US25):** o login social pula o formulário de cadastro, onde fica o aceite. O espelho nasce com `termsAcceptedAt = null`; o app deve checar esse campo na resposta de `POST /auth/session` e mostrar o aceite (`POST /auth/terms`) antes de liberar o uso.

**Apple fora do escopo:** Sign in with Apple foi considerado e deixado de fora por decisão do time. Consequência a acompanhar: a App Store exige Sign in with Apple quando o app oferece outro login social no iOS (guideline 4.8) — antes de publicar na App Store, ou ele entra (mesmo desenho: provedor `SignInWithApple` no pool, sem mudança na API), ou o Google sai do iOS.

**Logout:** `RevokeToken` encerra a sessão do app, mas o domínio do pool mantém um cookie de sessão no navegador; sem abrir `/logout`, o próximo "Entrar com Google" pode entrar direto na mesma conta, sem perguntar. O app deve abrir `/logout?client_id=…&logout_uri=…` ao sair de uma conta social.

**Produção — o que precisa existir antes de ligar:**

- Domínio do pool (prefixo Cognito ou domínio próprio com certificado no ACM).
- **Google:** cliente OAuth "Web application" no Google Cloud, com `https://<domínio>/oauth2/idpresponse` como redirect autorizado; provedor `Google` no pool com `client_id`, `client_secret` e escopos `openid email profile`.
- Mapeamento de atributos: `email`, `email_verified` e `name`.
- App client com a configuração acima e só o scheme do app nas URLs.

**Consequências:** (+) backend sem mudança de código: um emissor, uma validação, o mesmo espelho; (+) o app ganha o Google sem SDK nativo, e outro provedor futuro entra pelo mesmo fluxo; (+) desenvolvível sem conta Google; (−) configuração de produção fora do repositório, em dois consoles (AWS e Google Cloud); (−) contas duplicadas por e-mail até a decisão de vinculação; (−) divergências do emulador (itens 2 e 4) que só aparecem na AWS.
