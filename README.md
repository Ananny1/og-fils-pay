# FilsPay

Card payments for Bahrain, settled to the fil (1 BD = 1000 fils, settlement day ends at midnight
Bahrain time). What we changed and why: `docs/challenge/PR-DESCRIPTION.md` and `docs/FINDINGS-REPORT.md`.

## ⚠️ How to log in (please read)

Every login asks for a password **and then a 6-digit code sent by email**. The code is never
shown on the screen; that was a security bug (A5) we fixed.

### On the live server

Hosted on Dilmune Cloud (server `og`, 1 vCPU / 2 GB, Bangalore), HTTPS with Let's Encrypt:

| Site | Link |
|---|---|
| Shop dashboard (merchant) | **https://og-filspay.139-59-1-82.nip.io** |
| Staff console (admin) | **https://admin.og-filspay.139-59-1-82.nip.io** |
| Health | https://og-filspay.139-59-1-82.nip.io/readyz |

The demo emails in the seed data (`@filspay.test`, `@….example`) are fake, so no email can reach
them. Only these two accounts have real inboxes. **Both were tested end to end on the live site on
30 Oct 2026 (password → emailed code → logged in).**

| Where | Merchant ID | Email | Password | Role |
|---|---|---|---|---|
| Shop dashboard | `ce668d19-d805-469d-bc7e-d3b1741a6f16` (Delta Wholesale Traders) | `eb.ipod2@gmail.com` | `Og-5093cdf944ad-Shop` | owner |
| Staff console | — | `alnasser.ebra@gmail.com` | `Og-caf15f011481-Staff` | super_admin |

The hosted box does **not** use the dev passwords below: production refuses seed passwords that
are committed in the repo, so it was seeded with its own (`SEED_USER_PASSWORD` /
`SEED_ADMIN_PASSWORD`). A password alone is not enough to get in: the code still goes to the
team's inbox.

The codes go to the team's inboxes. **Ask Ebrahim or Sayed and we will give you the code**
(it is valid for a few minutes, so tell us just before you log in). If a login is refused after a
few wrong tries, wait one minute (brute-force limit).

How the box runs: `ops/docker-compose.prod.yml` (nginx → api, Postgres, Go settlement, reporting
worker). Login codes are sent through Brevo on port 2525, because the host blocks the usual mail
ports. The server deploys the GitHub fork by itself every 2 minutes (`ops/prod/autodeploy.sh`, HOST-4).
Everything about the live deployment in one page: `docs/challenge/DEPLOYMENT.md`.

### On your own laptop

```bash
cd ops && docker compose up -d
```

- Shop dashboard: http://localhost:5173 · Staff console: http://localhost:5174
- **Every email lands in Mailpit at http://localhost:8025**, so every demo account works and you
  can read the code yourself.
- All demo logins (15 shop users, 3 staff users) are in `docs/challenge/SETUP.md` section 4.
