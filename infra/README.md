# Production infrastructure

CloudFormation templates for the production environment on AWS. Locally the same
resources come from MiniStack through `npm run dev:bootstrap` (ADR-12); these files
are their production counterpart.

**Region:** everything lives in `us-east-2`. The AWS account belongs to PUCRS, and an
organization policy denies the other regions, so the scripts pin the region instead
of reading it from your profile. The account is shared with other teams: every
resource is named `administranest-prod-*` (or `administranest-prod`).

Deploy from your machine, signed in with `aws login`.

## Cognito — `cognito.yaml`

User pool `administranest-prod`, its domain, the `Google` identity provider and the
`administranest-mobile` app client, configured as ADR-13 describes.

```sh
scripts/deploy-cognito.sh
```

Creates or updates the stack `administranest-prod-cognito` and prints the values to
copy:

- **backend:** `AWS_REGION`, `COGNITO_ISSUER`, `COGNITO_CLIENT_ID` (no
  `COGNITO_JWKS_URI` — on real AWS it is derived from the issuer);
- **client-mobile:** the `EXPO_PUBLIC_*` lines of its `.env.prod`.

None of them are secrets: the app client is public by design.

### Turning on Google sign in

1. In Google Cloud, create an OAuth client of type **Web application** and add the
   **Authorized redirect URI** the deploy script prints
   (`https://administranest-prod.auth.us-east-2.amazoncognito.com/oauth2/idpresponse`).
2. Deploy once with its credentials:

   ```sh
   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... scripts/deploy-cognito.sh
   ```

   Later runs without the variables keep the values already in the stack. The secret
   is a `NoEcho` parameter: CloudFormation never shows it back.

### Things to know

- **The pool is never deleted by the stack.** It has `DeletionProtection` and a
  `Retain` policy: deleting it would delete every account, and each account's `sub`
  is the key of the user mirror (ADR-02).
- **E-mail goes through Cognito's own sender** (`COGNITO_DEFAULT`), which has a low
  daily cap. Switching to SES is a separate task and must happen before real users.
- **Callback URLs** are only `administranest://auth/callback` (and
  `administranest://auth/signed-out` for logout). A hosted web build will need its
  own addresses added through the `CallbackUrls` / `LogoutUrls` parameters.
- `PreventUserExistenceErrors` is on: an unknown e-mail and a wrong password return
  the same `NotAuthorizedException`, which the app already shows as one message.
