# Profile — `/users/me` (US23)

The signed-in user's own registration data, as the Profile tab shows it. The
routes take no id: the token says whose profile this is (ADR-11).

The interactive version is in Swagger under the `users` tag
(`http://localhost:3000/docs`). This page is the contract in one place, with
real responses and what the app is expected to do with each one.

| Method | Route | What it does |
|---|---|---|
| `GET` | `/users/me` | Reads the profile |
| `PATCH` | `/users/me` | Edits the profile |

`DELETE /users/me` (US25) will be documented here as well.

All of them need `Authorization: Bearer <IdToken>`, and the mirror created by
`POST /auth/session` (ADR-02).

## The fields

| Field | Type | Rule |
|---|---|---|
| `id` | uuid | Local id of the user. |
| `name` | string | Full name. Always filled in: falls back to the e-mail on the first login. |
| `email` | string | Mirrored from Cognito on every login. Always filled in. |
| `crmv` | string \| null | Required to issue reports with professional identification (US28). |
| `birthDate` | ISO 8601 \| null | Stored as a date (`birth_date`), sent as UTC midnight. Only the date part is meaningful. The age is not stored: the app calculates it. |
| `sex` | `FEMALE` \| `MALE` \| `OTHER` \| `NOT_INFORMED` \| null | `NOT_INFORMED` is the user's explicit choice; `null` is a field never filled in. |
| `city` | string \| null | Free text, up to 120 characters. |
| `state` | string \| null | Two-letter UF code (`RS`, `SP`…). |

Every field is always present in the body. A field never filled in comes as
`null`, never omitted and never as an empty string.

What the app does with them:

- `null` is shown as "Not informed", not as a blank space;
- `crmv: null` is flagged as needed for reports (US28);
- the last response is kept locally, so the tab still opens offline.

## `GET /users/me`

### 200 — profile

Real response from the local environment, right after the first login:

```json
{
  "id": "dab6c28e-221a-40be-af88-b0587a6afe9b",
  "name": "Dev Local",
  "email": "dev@administranest.local",
  "crmv": null,
  "birthDate": null,
  "sex": null,
  "city": null,
  "state": null
}
```

And with some fields filled in (`state` still empty):

```json
{
  "id": "dab6c28e-221a-40be-af88-b0587a6afe9b",
  "name": "Dev Local",
  "email": "dev@administranest.local",
  "crmv": "RS-12345",
  "birthDate": "1990-04-15T00:00:00.000Z",
  "sex": "FEMALE",
  "city": "Porto Alegre",
  "state": null
}
```

### 401 — no token

```json
{
  "statusCode": 401,
  "code": "UNAUTHENTICATED",
  "message": "Missing or malformed Authorization header",
  "path": "/users/me",
  "timestamp": "2026-10-31T20:43:18.323Z"
}
```

A valid token with no mirror yet answers `401 USER_NOT_PROVISIONED`: call
`POST /auth/session` first.

### 404 — account deleted

`404 USER_NOT_FOUND` only happens right after the account is deleted. The guard
keeps the token's local id for up to five minutes (`AUTH_SUB_CACHE_TTL_MS`), so
in that window the request still reaches the service and finds no row. Once the
entry expires, the same token answers `401 USER_NOT_PROVISIONED`.

## `PATCH /users/me`

Edits `name`, `crmv`, `birthDate`, `sex`, `city` and `state`. Any other field —
`email` included, since Cognito owns it (ADR-02) — answers `400`.

- A field left out keeps its value; `null` clears it. `name` cannot be `null`.
- The response is the same body `GET /users/me` returns.
- Idempotent: the offline queue (ADR-08) resends the same body with no `/sync`
  route.

| Field | Rule |
|---|---|
| `name` | 2 to 120 characters, trimmed. |
| `crmv` | UF, hyphen, up to 6 digits: `RS-12345`. Upper-cased. |
| `birthDate` | Sent as `YYYY-MM-DD`, not the ISO date-time `GET` returns. From 1900 on, at least 18 years ago. |
| `sex` | One of the enum values. |
| `city` | Up to 120 characters, not blank. |
| `state` | One of the 27 UFs. Upper-cased. |

An invalid field answers `400 VALIDATION_ERROR`, naming the field in
`details.fields`.
