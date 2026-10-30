# BUG-032 — Merchant dashboard logs out after 10 minutes

| | |
|---|---|
| **Severity** | Medium |
| **Area** | Security (session handling) |
| **Analysis ID** | related to A13 |
| **Clue** | MK's comment in `routes/auth.ts` ("admin verify re-sets the cookie after this, merchant verify doesnt. related to the 10 min logouts?"); FH's note in `routes/adminAuth.ts` ("the merchant flow should do the same") |
| **Decision** | — |
| **Commit** | see `git log --grep "BUG-032"` |
| **Status** | ✅ fixed |

## 1. The issue — what was wrong

A merchant logs in (password + OTP) and starts working. Ten minutes after the
password step the browser silently deletes the session cookie and every page
returns 401 — although the server session is valid for 12 hours. Users are
pushed back to login mid-task, which also trains them to type passwords and
OTPs more often than needed.

## 2. Why it happened — the root cause

The login step sets the cookie with the **pending** lifetime:

```ts
// routes/auth.ts /login
reply.setCookie(app.config.cookieName, rawToken, { ..., maxAge: app.config.pendingSessionTtlMinutes * 60 }); // 600 s
```

`/otp/verify` promotes the session server-side to 12 h (`promoteSession`) but
never re-sets the cookie, so the browser keeps `Max-Age=600`. The admin
verify (`routes/adminAuth.ts`) does re-set it at the full TTL; the merchant
copy missed it. The inline comment "the cookie maxAge doesn't matter
because..." is wrong — `Max-Age` is exactly what makes the browser drop it.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| Customers (cardholders) | — | — |
| Merchants | Forced re-login every 10 minutes; lost form input | Medium |
| FilsPay (finance / ops) | Support tickets; users re-entering credentials often | Low |
| Acquirer / card scheme / partners | — | — |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/routes/auth.ts` `/otp/verify` | after promotion, `reply.setCookie(cookieName, rawToken, { httpOnly, path: "/", sameSite: "lax", secure: cookieSecure, maxAge: sessionTtlHours * 3600 })` |

Same token, same flags as at login (HttpOnly, SameSite=Lax, Secure in
production), only the lifetime now matches the server session. This mirrors
the admin flow exactly.

**Not changed (token rotation at verify):** issuing a *new* token at OTP
verify would also close a narrow pre-OTP-token-theft window. It was not done
here: the pending session is bound to the user who proved the password, so a
planted cookie cannot become someone else's session, and every existing test
(and any client) that keeps using the login cookie after verify would break.
Listed as a follow-up.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Re-set the same cookie at full TTL on verify | Mirrors admin; tiny | — | ✅ |
| 2 | Rotate to a fresh token on verify | Also hardens against pre-OTP token theft | Breaks clients that reuse the login cookie; bigger change | |
| 3 | Set the 12 h Max-Age already at login | One place | Pending cookie lives 12 h in the browser | |

**Why we chose #1:** fixes the user-visible bug with the same pattern the admin plane already uses.

## 6. Proof — tests

| Test | File | Before fix | After fix |
|---|---|---|---|
| `BUG-032: OTP verify re-issues the session cookie with the full session lifetime` | `apps/api/src/routes/auth.new.test.ts` | ❌ no Set-Cookie on verify (browser keeps Max-Age=600) | ✅ `Max-Age=43200; HttpOnly; SameSite=Lax` |

```bash
cd apps/api && npx tsx --test src/routes/auth.new.test.ts
```

Existing tests changed: none.
