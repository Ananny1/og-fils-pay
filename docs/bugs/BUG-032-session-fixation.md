# BUG-032 — The pre-OTP cookie becomes the logged-in session (fixation), and shops are logged out after 10 minutes

| | |
|---|---|
| **Severity** | Medium (High on the admin console) |
| **Area** | Security (session management) + usability |
| **Analysis ID** | A13 |
| **Clue** | YA in `adminAuth/sessions.ts`: "token not rotated on promote -> fixation. FP-198 (repro: copy the pending cookie into a 2nd browser before OTP)"; MK in `routes/auth.ts`: "merchant verify doesn't [re-set the cookie]. related to the 10 min logouts?" |
| **Evidence** | — (handover notes) |
| **Decision** | D-003, D-004 |
| **Owner** | Ebrahim |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** The cookie you get after typing your password silently becomes your full login once you enter the OTP; on the shop dashboard that cookie also expires after 10 minutes.
- **Why:** At OTP success the session row is only flagged `authenticated`; its token is never replaced, and the merchant route never re-sets the cookie (it keeps the 10-minute pending lifetime).
- **What it breaks:** Anyone who sees the pre-OTP cookie (shared PC, proxy log, screenshot) is logged in as soon as the real user finishes the OTP, including staff on the admin console; and shops are thrown out of the dashboard every 10 minutes.

## 1. The issue

YA's repro, before the fix: log in with the password, copy the cookie into a second browser, let the
real user enter the OTP. The second browser is now logged in too: same token, now authenticated.

On the shop dashboard the cookie is set at the password step with `maxAge = 10 minutes` and never
renewed, so the browser drops it 10 minutes after login although the session is valid for 12 hours.

## 2. Why it happened

- `apps/api/src/auth/sessions.ts` `promoteSession` and `apps/api/src/adminAuth/sessions.ts`
  `promoteAdminSession` ran only
  `UPDATE … SET authenticated = true, authenticated_at = now(), expires_at = $2 WHERE id = $1`.
  The token issued **before** the second factor stays the token **after** it.
- `apps/api/src/routes/auth.ts` `/otp/verify` set no cookie at all, so the login's
  `maxAge: pendingSessionTtlMinutes * 60` (10 min) stayed.
- MK dismissed YA's report: "the 2nd browser still needs the OTP. unresolved". It doesn't: the shared
  token becomes authenticated when **anyone** completes the OTP.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay staff (admin console) | A leaked pre-OTP admin cookie becomes a full admin session (impersonation, adjustments) | High |
| Merchants | Same for the dashboard; and logged out every 10 minutes | Medium |
| FilsPay support | "Why am I logged out?" tickets (MK's "10 min logouts") | Low |

## 4. The fix

| File | Change |
|---|---|
| `apps/api/src/auth/sessions.ts` | `promoteSession` also **rotates the token** (`token_hash = sha256(new token)`) and returns `{ expiresAt, rawToken }`. |
| `apps/api/src/adminAuth/sessions.ts` | `promoteAdminSession`: the same. |
| `apps/api/src/routes/auth.ts` | `/otp/verify` sets the new token as the cookie with the session's full TTL (`sessionTtlHours`). |
| `apps/api/src/routes/adminAuth.ts` | `/otp/verify` sets the **new** token (it re-set the old one before). |
| `apps/api/src/routes/auth.sessionRotation.test.ts` | New tests (below). |
| 5 existing test helpers + `auth.otpRecipient.test.ts` | Use the cookie returned by `/otp/verify` (see §6). |

Browsers replace the cookie automatically from the verify reply, so the dashboards need no change.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Rotate the token at promote; set it as the cookie with the full TTL, on both logins | Standard fix (OWASP: renew the session id after authentication); also ends the 10-minute logouts | Clients must take the cookie from the verify reply (browsers do) | ✅ |
| 2 | Only re-set the merchant cookie with the full TTL | Fixes the logouts | Fixation stays | |
| 3 | Bind the session to IP / user agent | Makes a copied cookie harder to use | Breaks mobile users whose IP changes; doesn't remove the shared token | |
| 4 | Outside the box: issue no session at the password step; keep the pending state in a separate short-lived signed token | The pre-OTP token could never be a session by design | Rewrites both login flows (an enhancement) | |

## 6. Proof

| Test | File | Before | After |
|---|---|---|---|
| merchant: the pre-OTP cookie does not become a logged-in session | `apps/api/src/routes/auth.sessionRotation.test.ts` | ❌ verify set no cookie | ✅ |
| merchant: the logged-in cookie lives as long as the session | same | ❌ no Max-Age=43200 | ✅ |
| admin: the pre-OTP cookie does not become a logged-in session | same | ❌ same token reused | ✅ |
| admin: the logged-in cookie lives as long as the session | same | ✅ | ✅ |

API suite: 383 tests, 371 pass, 12 fail = the T1 baseline (refund + webhook). `tsc` clean.

**Existing tests changed (D-004):** the login helpers in `app.test.ts`, `routes/admin.test.ts`,
`routes/adminCredits.test.ts`, `routes/adminBalanceAdjustments.test.ts`,
`routes/adminAdjustmentImport.test.ts` (and our own `auth.otpRecipient.test.ts`) returned the
**pre-OTP** cookie after verifying and used it for the rest of the test. That is exactly the
fixation; with the fix, 69 tests failed for that reason alone. Each helper now returns the cookie
from the `/otp/verify` reply, as a browser does. No assertion changed.

Real run (API rebuilt), YA's repro with curl cookie jars:

| | Before | After |
|---|---|---|
| Copy of the pre-OTP cookie, after the real user's OTP: `/me` | 200 (logged in) | **401** |
| Real user: `/me` | 200 | 200 |
| Cookie lifetime after verify | merchant 10 min (600 s) | merchant **43200 s** (12 h), admin 28800 s (8 h) |
