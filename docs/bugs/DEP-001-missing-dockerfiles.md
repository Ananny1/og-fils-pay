# DEP-001 — Dockerfiles missing: the stack can't be built

| | |
|---|---|
| **Severity** | Blocker |
| **Area** | Deploy |
| **Analysis ID** | D1 |
| **Clue** | `ops/README.md` — AM: "the two Dockerfiles aren't in the repo for me"; MK: "check you're on main" |
| **Decision** | D-003 |
| **Status** | ✅ fixed |

## Summary (the short note)

- **What's wrong:** The app could not be built: the two Dockerfiles that `docker compose` needs were never committed.
- **Why:** `ops/docker-compose.yml` points at `ops/Dockerfile.node` and `ops/Dockerfile.go`, which did not exist.
- **What it breaks:** Nobody could run, test or deploy FilsPay from the repo, including the Dilmune Cloud deploy.

## 1. The issue

`docker compose -f ops/docker-compose.yml build` fails at once: `ops/Dockerfile.node` and
`ops/Dockerfile.go` don't exist. Nothing can be built, tested or deployed.

## 2. Why it happened

Every service in compose has `dockerfile: ops/Dockerfile.node` or `ops/Dockerfile.go`, and neither
file was ever committed. AM built private copies; MK's "check you're on main" closed the
question without anyone looking.

## 3. Who was affected

| Party | How | How bad |
|---|---|---|
| FilsPay engineering | Can't run the stack on a clean machine | Total block |
| FilsPay ops | Can't deploy (FP-300 "live on Dilmune Cloud") | Total block |

## 4. The fix

| File | Change |
|---|---|
| `ops/Dockerfile.node` | New. Stage 1 (`node:20-bookworm-slim` + `python3 make g++`) runs `npm ci`; `argon2` must compile natively. Stage 2 (slim) copies only `node_modules` + source. Used by api, reporting, migrate, seed. |
| `ops/Dockerfile.go` | New. `golang:1.22-alpine` builds a static binary; `alpine` runtime with a non-root user. `cmd/settlement` embeds `time/tzdata`, so Asia/Bahrain loads without OS tzdata. |
| `.dockerignore` | New. Keeps `.git`, `node_modules`, env files and evidence photos out of the build context. |

Minimal: no app code or compose changes; the files match what `ops/README.md` describes.

## 5. Options considered (ranked)

| Rank | Option | Pros | Cons | Chosen? |
|---|---|---|---|---|
| 1 | Multi-stage images (compile in a builder stage, slim runtime) | Small images; Go build cache doesn't stay on the 2 GB box (AM's disk incident) | Slightly longer Dockerfiles | ✅ |
| 2 | Single-stage `node:20` / `golang` full images | Simplest | ~1 GB bigger; Go cache fills the demo box's disk | |
| 3 | Run without Docker (host Node/Go) | No images | Not how the hosted box runs; doesn't fix deploy | |

## 6. Proof

| Check | Before | After |
|---|---|---|
| `docker compose -f ops/docker-compose.yml build` | ❌ `Dockerfile.node: no such file` | ✅ 5 images built |
| `api`, `settlement`, `reporting` containers start | ❌ | ✅ (with DEP-002, DEP-003) |

Existing tests changed: none.
