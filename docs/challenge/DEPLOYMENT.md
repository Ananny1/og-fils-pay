# Deployment — where FilsPay runs and how it gets there

Team **og**: Ebrahim Alnasser and Sayed Hassan Isa. Checked live on 30 Oct 2026.

## Live links

| What | Link |
|---|---|
| Shop dashboard (merchant) | https://og-filspay.139-59-1-82.nip.io |
| Checkout (customer) | https://og-filspay.139-59-1-82.nip.io/pay/&lt;token&gt; (the token is on each payment link in the dashboard) |
| Staff console (admin) | https://admin.og-filspay.139-59-1-82.nip.io |
| Public API | https://og-filspay.139-59-1-82.nip.io/v1 |
| Health | `/readyz` (checks the database) · `/healthz` (process up) |
| Source (public fork) | https://github.com/Ananny1/og-fils-pay (branch `main`) |

Demo logins and how to get the email code: `README.md` → "How to log in".

## The server

| Item | Value |
|---|---|
| Host | Dilmune Cloud, server `og`, 1 vCPU / 2 GB, IP `139.59.1.82` |
| HTTPS | nginx + Let's Encrypt (certbot), certificate renews itself |
| Optional relay | `ops/dilmune-edge` (Dilmune Sites `*.dilmune.app` → nginx :80) |
| Stack | `ops/docker-compose.prod.yml`: nginx → api (Fastify), Postgres, Go settlement, reporting worker |
| Image | `ops/Dockerfile.node.prod` (Node 22) |
| Secrets | `ops/.env.prod` on the server only (git-ignored, chmod 600). Template: `ops/.env.prod.example` |
| Email codes | SMTP relay on port 2525 (the host blocks the usual mail ports) |

## How a change reaches the live site

1. A fix is committed and pushed to a person's branch (`ebrahim/track-b`, Sayed's branch).
2. The team merges it into **`main` of the fork** on GitHub.
3. On the server, a systemd timer runs `ops/prod/autodeploy.sh` every 2 minutes (HOST-4). When
   `main` has a new commit it builds that commit, runs the migrations and restarts the stack.
   The demo seed is never re-run, so live data survives deploys.

Pull, not push: the server needs no GitHub credentials and GitHub holds no key to the server.

Manual redeploy on the server: `sh ops/prod/autodeploy.sh --force`.

## Settings that must be right on the server

| Setting | Why |
|---|---|
| `CHECKOUT_BASE_URL=https://og-filspay.139-59-1-82.nip.io` | Payment links and QR codes point here (the example value `filspay.example.com` breaks them) |
| `SEED_USER_PASSWORD`, `SEED_ADMIN_PASSWORD` | Production refuses the dev passwords committed in the repo |
| `TRUST_PROXY=true` | Real client IP behind nginx, so per-IP login limits work |
| `API_MAX_IN_FLIGHT` | Extra load is turned away fast (503 + Retry-After) instead of timing out |
| `ANTHROPIC_API_KEY` | The assistant; kept only in `ops/.env.prod` |

## Related documents

- Capacity on this box: `docs/challenge/CAPACITY.md`, `docs/ops/CAPACITY.md`
- Security on the edge (headers, per-IP limits): `docs/challenge/SECURITY.md`, `docs/challenge/DDOS.md`
- Running it on a laptop: `docs/challenge/SETUP.md`
