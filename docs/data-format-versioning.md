# Sync data-format versioning

Budgero is zero-knowledge: the server stores opaque encrypted blobs and
mutation payloads it can never read. That means a data-format change (like the
v1.5 float→integer money migration) cannot be translated server-side — every
client migrates its own copy, and the fleet has to be kept from mixing
formats. This document describes the machinery that makes such changes safe.

## The format version

`MUTATION_FORMAT_VERSION` / `SYNC_PROTOCOL_VERSION` (packages/runtime
`src/sync-format.ts`) identify the client data format.

| Format | Meaning |
| --- | --- |
| 1 (implicit) | Legacy: monetary values as decimal floats. Payloads carry no `v` field. |
| 2 | All monetary values are integer milliunits (1/1000 unit; $12.34 = 12340). Payloads are `{v: 2, op, args}`. |

## Client-side layers

- **Mutation envelope** — `encryptMutation` embeds `v` inside the encrypted
  JSON. On receive, `normalizeMutationPayload` upgrades legacy payloads
  (money keys ×1000) and throws `FormatTooNewError` for anything newer than
  the build understands; the transport surfaces that via
  `onFormatTooNew` → blocking "update required" UI.
- **Offline queue** — entries persist with their `v`; `deserializeMutation`
  upgrades legacy entries at load, so mutations queued by an old build replay
  correctly after the app updates.
- **Local database** — schema version (migration 039 performed the milliunit
  rebuild). The migration runner refuses to touch a database *newer* than the
  build (`DatabaseNewerThanAppError`) instead of silently operating on a
  schema it doesn't know — this covers restored backups from newer builds.
- **HTTP headers** — every sync request declares `X-Budgero-Protocol`
  (highest format the client understands); blob uploads additionally declare
  `X-Data-Format-Version` (format of the uploaded bytes). WebSocket clients
  pass `?protocol=` instead (browsers cannot set WS headers).

## Server-side gate

`budget_space_blobs.data_format_version` records each space's format
(declared on upload — the server cannot inspect the ciphertext; it never
lowers). Handlers in `internal/adapter/driving/http/handler` return
**426 Upgrade Required** when:

- a client downloads a blob whose format exceeds its declared protocol,
- a client uploads bytes declared older than the space's stored format,
- a WebSocket connects to a space whose format exceeds its `?protocol=`.

This is what protects *pre-versioning* clients (which know none of the above):
their sync fails safely instead of misreading milliunits as dollars and
writing 1000×-off values back.

## Rollout properties

Server and PWA ship in one binary, so the gate deploys atomically with the
new client. The first device to load the new build migrates its spaces and
uploads format-2 blobs; any straggler device (stale cached PWA, pinned Python
SDK) gets clean 426 rejections until it updates. Data already written is
never touched by a client that doesn't understand it.

## Adding format 3 someday

1. Bump `MUTATION_FORMAT_VERSION`/`SYNC_PROTOCOL_VERSION` and teach
   `normalizeMutationPayload` (and the queue upgrader) to lift v2 → v3.
2. Write the corresponding core schema migration; the downgrade guard and
   metadata/op-JSON converters in migration 039 are the template.
3. Bump `CurrentDataFormatVersion` on the server and the SDK's declared
   protocol.
4. Nothing else: the gates, headers, and update-required UI are generic.
