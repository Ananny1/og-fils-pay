# Event rules and deadline (from the host's site, bhash.org/events/the-handover, read 2026-10-30)

| | |
|---|---|
| **Submission** | A **GitHub pull request against the challenge repo**, open by **Friday 30 Oct, 10:00 PM** (from anywhere) |
| **Hosting** | **Dilmune Cloud, required**: the app must be live for the judges. Every participant gets a discount code. Talk "Hosting on Dilmune Cloud" Fri 5:00 PM at Reboot01. |
| **Judging** | Sat 31 Oct: arrive 12:30, semi-final judging 2:00–5:00 PM in 5 rooms, top 5 pitch at 5:00 PM, awards 6:00 PM. Placement from judges' scores only. Both members attend. |
| **Stack** | Go, Python and TypeScript; work across all three |

## Rules that affect our work

| # | Rule | What it means for us |
|---|---|---|
| 04 | Any AI tools are allowed. **Declare your tools and setup.** | `docs/challenge/AI-USAGE.md` + the AI setup files in the repo (also the rubric's "AI usage" 10 pts) |
| 05 | Personal templates / harness repos must be public and declared | We use none; say so in the PR |
| 06 | **Work with the codebase you are given: fix it rather than rewriting** | Minimal fixes only (already our rule); the scoring sheet also says "a small fix that works scores more than a big rewrite" |
| 07 | **The core service stays as it is, and the database stays in place** | No replacing Postgres or the API framework. Additions in front (nginx edge limits, static file serving) and new tables/migrations are fine |
| 08 | **Submit by 10:00 PM on Friday** | Leave time for the PR: the deadline is a hard stop |

## Time plan for Friday 30 Oct

| Time | What |
|---|---|
| until ~17:00 | Bug and security agents finish; merge and test; findings report |
| 17:00 | Dilmune hosting talk (get the discount code and the deploy steps) |
| 17:30–20:30 | Deploy to Dilmune (🔔 Q-7: seed once), capacity test on the live box, after screenshots |
| 20:30–21:30 | Final docs, findings report statuses, AI usage, PR description |
| **≤ 21:30** | **Ebrahim opens the PR** (agents never open PRs: Ebrahim asks explicitly) |
| 22:00 | Deadline |
