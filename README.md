# Shared Bill Splitter

A household bill-splitting app built with Hono on Cloudflare Workers, Cloudflare D1 (SQLite), and a React/Vite frontend using TanStack Router.

## Architecture

- `api/src/index.ts` defines the Worker routes; `api/src/repository.ts` owns D1 queries, `api/src/types.ts` contains shared response types, and `api/src/validation.ts` handles request validation.
- `api/src/response.ts` keeps API error responses in the required JSON shape.
- `api/migrations/` contains the relational D1 schema, foreign keys, checks, indexes, and same-home share trigger.
- `web/src/api.ts` is the typed, runtime-validated API client. `web/src/routes/index.tsx` provides home, member, bill, balance, and payment flows.
- The browser stores the last opened home ID locally. Share amounts and totals are persisted as integer cents.

## Run locally

Use Node.js 22.12 or newer to run the development and validation commands. Wrangler 4.156 requires Node 22, and Vite 8 requires Node 20.19 or newer. `pnpm dev` checks this requirement before starting either server; `pnpm install` does not run Wrangler type generation. Install dependencies once at the workspace root, then start the Worker and web development server:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The API listens on `http://localhost:8787`. The development script applies pending D1 migrations to the local database before starting Wrangler. Create a home, add members, and create a bill, or open a home by entering its ID.

## API

All errors use `{ "error": "message" }`.

| Method | Path                                     | Purpose                                                    |
| ------ | ---------------------------------------- | ---------------------------------------------------------- |
| `GET`  | `/api/health`                            | Worker health check                                        |
| `POST` | `/api/homes`                             | Create a home with `{ "name": string }`                    |
| `GET`  | `/api/homes/:homeId`                     | Read a home and its members in join order                  |
| `POST` | `/api/homes/:homeId/members`             | Add an ordered member                                      |
| `POST` | `/api/homes/:homeId/bills`               | Create a bill and atomically split its integer-cent amount |
| `GET`  | `/api/homes/:homeId/bills`               | Read bills with member names and shares                    |
| `GET`  | `/api/homes/:homeId/balances`            | Sum unpaid shares per member                               |
| `POST` | `/api/bills/:billId/shares/:shareId/pay` | Pay a share; requires `Idempotency-Key`                    |

Every bill share is rounded down to whole cents, with remainder cents assigned to members in join order. The API permits a zero-cent share for bills smaller than their member count.

## Decisions

1. **Relational schema and ordering:** Homes, members, bills, and shares are separate tables. Members and bills store a per-home position with a unique constraint, so list and split order remains deterministic even when timestamps match. A trigger ensures a share's member belongs to the bill's home without duplicating the home ID in the share row. The trade-off is maintaining explicit positions and one small trigger.
2. **Atomic payment and idempotency:** A payment is one conditional SQLite `UPDATE` that only changes an unpaid share and rejects keys already used elsewhere; a unique key constraint is the final integrity guard. The key and UTC ISO-8601 timestamp are stored on the share, so D1 does not need an interactive transaction and identical retries return the original result. A key can be used for only one share.
3. **Confirmed frontend payment state:** The dashboard uses a single typed API client, validates unknown response data, disables the active payment button, and reuses a per-share idempotency key after failed attempts. It marks a share paid only after the API confirms success, then reloads balances and bills. The trade-off is a short delay while the server response arrives, rather than optimistic UI updates.

## Quality checks

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` runs the Worker/D1 API tests and the web dashboard tests in jsdom.
