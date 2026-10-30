# BUG-035 — A support admin can post credits (money) to any merchant alone

| | |
|---|---|
| **Severity** | High |
| **Area** | Security · Money |
| **Analysis ID** | — (new) |
| **Clue** | `admin/credits.ts createCreditRequest` JSDoc: "Requires finance or super_admin; a support caller gets a 403 from here"; `0031_admin_users.sql` role table |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-035"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

`POST /v1/admin/merchants/:id/credits` was open to **every** admin role.
A credit below the 50.000 BD approval threshold posts to the ledger
immediately with no second person. So a `support` operator — the lowest
role, meant for look-ups and reversible ops — could post up to 49.999 BD to
any merchant's payable balance, as many times as they liked (that money is
then paid out at settlement).

Reproduce: log in as a support admin, issue a 10.000 BD credit → 201,
`status: "posted"`, ledger entry created.

## 2. Why it happened — the root cause

`apps/api/src/routes/adminCredits.ts` registers the list and create routes in
a scope with only `requireAdminSession`; only approve/reject sit in the
`requireAdminRole("finance", "super_admin")` scope:

```ts
// before
app.register(async (scope) => {
  scope.addHook("preHandler", requireAdminSession);
  scope.get(... "/credits" ...);
  scope.post(... "/merchants/:id/credits" ...);   // no role gate
});
```

The function it calls documents the opposite ("support gets a 403 from
here"), and 0031 defines support as "read access plus routine, reversible
ops" and finance as "money-adjacent actions". `docs/ADMIN.md` says support
can "issue small credits" — a low-trust document that contradicts both the
schema and the code's own contract. Balance adjustments (the other "put money
on a merchant" action) are already finance-gated.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | — |
| Merchants | Could be paid money nobody with authority approved | Medium |
| FilsPay (finance / ops) | Lowest-privilege staff (or a stolen support login) could pay out money unchecked; splitting into sub-threshold credits avoids two-person control | High |
| Acquirer / card scheme / partners | — | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/adminCredits.ts` | create route gets `{ preHandler: requireAdminRole("finance", "super_admin") }` |

```ts
// after
scope.post("/merchants/:id/credits",
  { preHandler: requireAdminRole("finance", "super_admin") }, ...)
```

The scope's `requireAdminSession` hook runs first, then the role gate, the
same chain every other gated admin route uses. Reading the credits queue stays
open to support (existing test "a support admin CAN read the credits queue").

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Role-gate the create route (finance/super_admin) | Matches code contract and 0031; one line | Support must ask finance for goodwill credits | ✅ |
| 2 | Let support create, but force every support credit through approval | Keeps ADMIN.md workflow | New rule in the money path; more code | |
| 3 | Leave it (trust ADMIN.md) | — | Lowest role moves money alone | |

**Why we chose #1:** the code's own contract and the role model say so, with the smallest change. If the business wants option 2, it is an additive change later.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-035: a support admin cannot issue a credit; finance can` | `apps/api/src/routes/adminCredits.new.test.ts` | ❌ 201, credit posted to the ledger | ✅ 403, nothing recorded; finance 201; support can still list |

```bash
cd apps/api && npx tsx --test src/routes/adminCredits.new.test.ts src/routes/adminCredits.test.ts
```

Existing tests changed: none.
