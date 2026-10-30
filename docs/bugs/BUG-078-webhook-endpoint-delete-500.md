# BUG-078 — Deleting a webhook endpoint that has deliveries returns 500

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Webhooks |
| **Analysis ID** | — (new, bug hunt) |
| **Clue** | False comments in `webhooks/cancel.ts` ("FK is ON DELETE SET NULL (0029)") and `routes/webhooks.ts` ("ON DELETE CASCADE added in 0047") |
| **Decision** | — |
| **Commit** | see `git log --grep BUG-078` |
| **Owner** | Sayed |
| **Evidence** | test below |
| **Status** | ✅ fixed |

Present in the original code: `apps/api/src/webhooks/cancel.ts:22` (plain DELETE) + `db/migrations/0022_webhook_deliveries.sql:6` (FK, no ON DELETE) at 8b58b0f.

## Summary (the short note)

- **What's wrong:** a merchant cannot delete a webhook endpoint once it has received even one event; the dashboard gets a 500.
- **Why:** `webhook_deliveries.endpoint_id` (and `webhook_delivery_archives.endpoint_id`) reference `webhook_endpoints` with no `ON DELETE` action, so the `DELETE` fails on the foreign key.
- **What it breaks:** merchants can't remove an old or compromised receiver URL; only an endpoint that never got an event can be deleted.

## 1. The issue — what was wrong

Register an endpoint, capture one payment (the dispatcher creates a delivery row), then
`DELETE /v1/merchants/:id/webhook-endpoints/:endpointId` → 500
`update or delete on table "webhook_endpoints" violates foreign key constraint "webhook_deliveries_endpoint_id_fkey"`.
The existing CRUD test only deletes an endpoint with no deliveries, so it never saw this.

## 2. Why it happened — the root cause

`db/migrations/0022_webhook_deliveries.sql:6` and `0068_webhook_delivery_archives.sql:13`:

```sql
endpoint_id UUID NOT NULL REFERENCES webhook_endpoints (id),   -- no ON DELETE
```

`apps/api/src/webhooks/cancel.ts` then ran a plain `DELETE FROM webhook_endpoints ...`. Its
docblock says deliveries are "kept with endpoint_id set to NULL", and two comments claim the FK
was changed in 0029 (SET NULL) and 0047 (CASCADE). 0029 is a payment-links index and 0047 is the
merchant discount column; neither touches these tables. Both claims are false.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | none |
| Merchants | can't delete an endpoint that ever received an event; a leaked/old URL can only be disabled | Medium |
| FilsPay (finance / ops) | 500s in the logs; support tickets | Low |
| Acquirer / card scheme / partners | — | none |

## 4. The fix

| File | Change |
|---|---|
| `db/migrations/0106_webhook_endpoint_delete_keeps_deliveries.sql` | `endpoint_id` nullable, FK re-created `ON DELETE SET NULL` on `webhook_deliveries` and `webhook_delivery_archives` |
| `apps/api/src/webhooks/cancel.ts` | in one transaction: lock the merchant's endpoint, mark its `pending` deliveries `failed` ("not sent: webhook endpoint was deleted"), then delete |

The delivery log stays (it is the audit trail, as 0068 and the docblock require); only the link
to the removed endpoint becomes NULL. Pending retries are closed so the dispatcher's due index
does not keep rows that can never be sent.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | FK `ON DELETE SET NULL` + close pending deliveries | matches the documented contract; history kept | one migration | ✅ |
| 2 | `ON DELETE CASCADE` | one line | destroys the delivery audit trail | |
| 3 | Turn DELETE into a soft delete (status flip) | no schema change | changes the API meaning; endpoint still listed | |

**Why we chose #1:** it is what the code and docs already promised, and loses no history.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-078: deleting an endpoint with deliveries keeps the log and stops pending retries` | `apps/api/src/webhooks/cancel.new.test.ts` | ❌ FK violation error | ✅ passes |

```bash
cd apps/api && npx tsx --test src/webhooks/cancel.new.test.ts src/routes/webhooks.test.ts src/webhooks/dispatcher.test.ts src/webhooks/archiveReplay.test.ts
```

Existing tests changed: none.
