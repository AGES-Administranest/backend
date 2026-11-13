# Report history — `/reports` (US32)

The reports and packages the user generated, kept so they can be opened again
without generating them from scratch: the general report PDF (US28) and the
package for the accountant (US30). The history lists them, issues a link to
download a file again and deletes one.

The interactive version is in Swagger under the `reports` tag
(`http://localhost:3000/docs`). This page is the contract in one place, with
real responses, and how a generated file is recorded.

| Method | Route | What it does |
|---|---|---|
| `GET` | `/reports` | Lists the generated reports, newest first |
| `GET` | `/reports/:id/file` | Issues a download URL for one of them |
| `DELETE` | `/reports/:id` | Deletes one of them |

All of them need `Authorization: Bearer <IdToken>`. A user only ever sees their
own reports (ADR-11): another user's report answers the same `404` as one that
does not exist.

## Lifecycle of a report

A generated file is recorded by `ReportArchiveService.store`
(`src/modules/reports/report-archive.service.ts`), in this order:

1. The row is created **`PENDING`**, already with the S3 key, the file name and
   the size.
2. The file is stored in the bucket, at `users/<userId>/reports/<id>/original`.
3. The row turns **`DONE`**, and `store` returns the report id.

If storing the file fails, the row turns **`FAILED`** and the error goes up:
the generation fails too, and the app shows the error. Nothing is half-listed:

| Status | Listed | Downloadable | Deletable |
|---|---|---|---|
| `PENDING` | No | No | No |
| `DONE` | Yes | Yes | Yes |
| `FAILED` | No | No | No |

A row left `PENDING` (the process stopped between the upload and the update)
stays invisible. Since the row is written before the file, every object in the
bucket has a row with its key.

The general report PDF (`POST /reports`, US28) is recorded this way: its
`ReportExportService` calls `store` and builds the download link from the id it
returns. The package for the accountant (US30) will call it the same way.

### Recording a new kind

A generator calls `store` with what it produced:

```ts
const id = await reportArchive.store(userId, {
  kind: ReportKind.TAX_PACKAGE,
  period: { from: '2026-10-01', to: '2026-10-31' },
  filters: {},          // what the file was generated from
  fileName: 'administranest_pacote-contabil_2026-10-01_2026-10-31.zip',
  contentType: 'application/zip',
  body,                 // Uint8Array
});
```

The generator chooses the file name, with its extension: the key has none, and
the name is what the download saves the file as. `ReportArchiveService` is
exported by `ReportsModule`. The columns and the shape of `filters` per kind
are in [`data-dictionary.md`](data-dictionary.md#reports--report).

## `GET /reports`

| Query | Default | Rule |
|---|---|---|
| `kind` | every kind | `GENERAL_REPORT` or `TAX_PACKAGE` |
| `page` | `1` | `1`–`10000` |
| `limit` | `20` | `1`–`100` |

Newest generation first. Reports generated in the same instant come in a fixed
order, so paging never repeats or skips one. The answer is an array with no
total: **a page shorter than `limit` is the last one**.

`200`:

```json
[
  {
    "id": "cddd07fa-a6c1-4a8d-8273-6f6c60ee4a38",
    "kind": "TAX_PACKAGE",
    "fileName": "administranest_pacote-contabil_2026-10-01_2026-10-31.zip",
    "fileBytesSize": 22,
    "period": { "from": "2026-10-01", "to": "2026-10-31" },
    "generatedAt": "2026-11-12T20:47:38.330Z"
  },
  {
    "id": "11637945-c021-47dc-ac72-0d155d52c9af",
    "kind": "GENERAL_REPORT",
    "fileName": "administranest_relatorio-geral_2026-10-15_2026-11-14.pdf",
    "fileBytesSize": 391,
    "period": { "from": "2026-10-15", "to": "2026-11-14" },
    "generatedAt": "2026-11-12T20:47:38.261Z"
  }
]
```

- `period` has both days included, as `YYYY-MM-DD`.
- `fileName`, `fileBytesSize` and `period` are `null` only for a report that
  was recorded without them; `store` always fills them in.
- What the file was generated from (`filters`) is not part of the answer.

`400 VALIDATION_ERROR` for an unknown `kind`, a `page` or `limit` out of range,
or an unknown field such as `userId`.

## `GET /reports/:id/file`

`200`:

```json
{
  "url": "http://localhost:4566/administranest-local/users/057085b1-…/reports/11637945-…/original?X-Amz-Algorithm=…",
  "expiresAt": 1794430000000
}
```

- The URL downloads the **same file** that was generated, not a new one.
- It needs no token: the signature is the permission.
- It **expires in five minutes** (`expiresAt`, in ms since the epoch, comparable
  with `Date.now()`). To download again later, ask for a new one.
- The download is named `fileName`
  (`Content-Disposition: attachment; filename="…"; filename*=UTF-8''…`).

`404 REPORT_NOT_FOUND` for a report that is not in the history: missing,
another user's, `PENDING`, `FAILED` or deleted. `400` when the id is not a UUID.

```json
{
  "statusCode": 404,
  "code": "REPORT_NOT_FOUND",
  "message": "Report c5b61f74-d0ad-4117-a285-c93420970007 not found",
  "details": { "id": "c5b61f74-d0ad-4117-a285-c93420970007" }
}
```

## `DELETE /reports/:id`

`204` with no body. The app asks the user to confirm before calling it.

What it removes, in this order:

1. **From the history:** `deleted_at` is set. From then on the report is not
   listed, its file cannot be downloaded through the API, and deleting it again
   answers `404`.
2. **From the bucket:** the file is deleted.

What stays: the row, with its key in `file_url`. A URL issued before the delete
stops working once the file is gone; only if deleting the file failed does it
keep working until it expires, at most five minutes later.

The two steps cannot be one transaction. If deleting the file fails, the
answer is still `204`: the report is already out of the history, and the
failure is logged with the report id, so the leftover file can be found by
`deleted_at IS NOT NULL`.

`404 REPORT_NOT_FOUND` and `400` as in the download.

## Follow-ups

- Add a CHECK that a `DONE` row has `file_url`, `file_name` and
  `file_bytes_size`.
- Rows left `PENDING`, and files left behind by a failed delete, are not cleaned
  up: nothing removes them yet.
