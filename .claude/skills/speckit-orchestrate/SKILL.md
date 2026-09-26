---
name: speckit-orchestrate
description: Run a feature through the full Spec Kit flow (specify → clarify → plan → tasks → analyze → implement → verify → converge → review → PR) by dispatching tiered subagents — Opus plans, Sonnet builds, Haiku runs chores — with exactly two user checkpoints. Resumable after interruptions.
argument-hint: "\"<feature description>\" | --resume [spec-dir] | --from <phase> <spec-dir>"
disable-model-invocation: true
effort: medium
allowed-tools: Bash(git status *) Bash(git diff *) Bash(git log *) Bash(git show *) Bash(git add *) Bash(git commit *) Bash(git checkout -b *) Bash(git switch -c *) Bash(git pull *) Bash(git fetch *) Bash(docker pull *) Bash(docker compose run --rm *) Bash(docker compose --profile e2e run --rm *)
---

# Spec Kit orchestrator

You are the **orchestrator**, running in the main session. You dispatch, gate, commit, and talk to
the user. **You don't do the phases' work yourself.** Each phase belongs to a subagent defined in
`.claude/agents/sk-*.md`, and each subagent's model, effort, tools and guard hooks are set there.
Keep your own context lean. Read agent reports, not the artifacts, unless a gate needs a spot
check.

Input: `$ARGUMENTS`

## Modes

- `"<feature description>"`: a new feature. Start at phase 0.
- `--resume [spec-dir]`: read `<spec-dir>/run-log.md` (default: the path in
  `.specify/feature.json`) and continue from the first phase not marked `done`. For implement,
  continue from the first package not marked `done`.
- `--from <phase> <spec-dir>`: start at `<phase>`, one of `specify`, `plan`, `tasks`, `analyze`,
  `implement`, `verify`, `converge`, `review` or `ship`. This assumes the earlier artifacts exist.
  Verify they do, and set `.specify/feature.json` to that directory.

## Dispatch conventions

- Use the Agent tool with `subagent_type` set to the `sk-*` name, and **don't** pass `model`:
  the definition sets it. Default to `run_in_background: true`, and wait for completion
  notifications. Never poll.
- **Prompts are pointers.** Give the feature dir, the phase, the IDs, and any answers or digests.
  The standing instructions already live in the agent definitions.
- **Fix and clarify loops use `SendMessage` to the same agent ID**, never a fresh spawn. A resumed
  agent keeps its context and prompt cache.
- **Concurrency:** at most **3** implementers at once, and only for packages in the same wave with
  disjoint `Owns` globs.
- **Verify, don't trust.** A report is a claim. Before passing a gate, spot-check it cheaply:
  `git status --short` shows only the expected files, the verify command's output was actually
  seen by the test runner, and so on.
- **When an agent stops early** (maxTurns, a rate or session limit, or an API error): record it in
  the run-log. Resume the agent via `SendMessage` if possible; if not, re-dispatch that phase or
  package. On a usage-limit error, stop and tell the user when it resets. The run-log makes
  `--resume` safe.

## Run-log: `<feature-dir>/run-log.md`

Append-only. Create it at phase 0. After every phase or package, append one line:

```
| 2026-09-26 14:05 | implement | WP2 | done | sk-implementer a1b2c3 | api 297/297 |
```

Columns: time · phase · item · `started|done|failed|skipped` · agent + ID · evidence. Commit it
along with each commit you make.

## Phases

### 0 · Preflight (deterministic, no agents)
1. `git status --short` must be clean. If it isn't, stop and ask the user.
2. `git fetch` and confirm the base is up to date with `origin/main`.
3. **Docker probe:** run `docker pull node:24-slim` in the background with a 30 s cap. If it hangs,
   warn the user now. Pulls hung for an hour on 2026-09-26, and the stack can still run from cached
   images, but builds can't.
4. For a new feature: work out the next `NNN` from `specs/`, create the branch `NNN-short-name`
   from `main`, `mkdir specs/NNN-short-name`, and write the run-log header.

### 1 · Specify + clarify: `sk-spec-author`
Dispatch it with the description, the feature dir and the branch. Parse the report.
- If `STATUS: needs-answers`, ask the `QUESTIONS` with **AskUserQuestion**, at most 4 per call and
  in their priority order. Pass each question's options through, recommended option first. Then
  `SendMessage` the answers to the **same agent**, formatted as `Q1: <label>[, note]`. Repeat until
  `STATUS: ready`.

### 2 · Plan: `sk-planner`
If the report shows `CONSTITUTION: violation`, stop and tell the user. If it shows
`amendment-drafted`, carry the draft to Checkpoint 1.

### 3 · Tasks: `sk-tasker`
Choose the **track** from its `TRACK HINT` and your own judgement:
- **S:** skip phase 4 and phase 9; one implementer per wave.
- **M:** the full flow.
- **L:** the full flow, plus a `/speckit-checklist`-style requirements checklist pass via
  `sk-analyst`, and a second reviewer pass after the fixes.

### 4 · Analyze: `sk-analyst` (M and L only)
If it reports CRITICAL or HIGH findings, route each to its owner (`planner`, `tasker` or
`spec-author`) with `SendMessage` to that agent's existing ID. Then re-analyze. Allow at most 2
loops. If findings remain, carry them to Checkpoint 1.

### 5 · CHECKPOINT 1 (user)
Show the user one screen:
- the scope (≤ 5 lines, from spec-author);
- the key decisions (from planner);
- the Work Packages table with waves and tiers;
- the analyze result;
- any constitution amendment draft;
- the track.

Ask with **AskUserQuestion**: **Build it (Recommended)** / **Revise first** / **Stop here**.
- **Revise first:** take the user's notes and route them via `SendMessage` to the owning agent.
  Re-run tasks and analyze if the plan changed, then return to this checkpoint.
- **Build it:** if there's an approved amendment, apply it to `.specify/memory/constitution.md`
  yourself (you're the only one who edits the constitution). Then commit the spec artifacts:
  `git add specs/NNN-… .specify/feature.json [.specify/memory/constitution.md]`, with the message
  `docs: spec NNN-short-name (…)`.

### 6 · Implement: `sk-implementer` / `sk-chore`
Go wave by wave. For each package, dispatch `sk-implementer` (tier `sonnet`) or `sk-chore` (tier
`haiku`) with the prompt:

`Feature dir: <dir>. Execute Work Package <WPn> per tasks.md.`

When a package reports `done`:
- confirm `git status` shows changes only within its `Owns` globs;
- commit it **yourself** by explicit paths, with a message like `feat(NNN): WPn — <summary>` and
  the Co-Authored-By line from the system attribution rules;
- log it in the run-log.

If it's `blocked`, fix the ownership or dependency in `tasks.md` yourself, or resume the agent with
a decision. If it's `partial`, resume the same agent.

### 7 · Verify: `sk-test-runner`
Give it the full-suite commands. For this repo:
- `docker compose run --rm api sh -c "npm test && npm run typecheck"`
- `docker compose run --rm --no-deps web sh -c "npm test && npm run typecheck"` (if `web/` was
  touched)
- `docker compose --profile e2e run --rm e2e` (if UI was touched)

If it comes back `red`, `SendMessage` each failure to the implementer that owns it (look up the
agent ID in the run-log), then re-verify. After **2 failed fix loops** for the same package,
dispatch `sk-reviewer` in diagnose mode and relay its fix. If it comes back `env-failure`, stop and
tell the user.

### 8 · Converge: `sk-converger`
If it reports `gaps`, go back to phase 6 with the new packages `WPc*`. Allow at most 2 rounds;
after that, carry the remaining gaps to Checkpoint 2.

### 9 · Review: `sk-reviewer` (M and L only)
Turn `BLOCKING` findings into fix instructions: `SendMessage` them to the owning implementer, then
go back to phase 7. Keep `NON-BLOCKING` findings for the PR body.

### 10 · Sync (haiku)
Dispatch `sk-chore` to add the feature's "Current state" paragraph to CLAUDE.md and to confirm
every task is `[X]`. Then commit.

### 11 · CHECKPOINT 2 (user) and ship
Show:
- the verified results (test counts per suite, and any budget or a11y numbers);
- the commits;
- deviations reported by agents;
- non-blocking review notes;
- known gaps that need a human (e.g. screen reader or real device checks).

Ask with **AskUserQuestion**: **Push and open PR (Recommended)** / **Hold locally** /
**Revise …**. To ship:
- push the branch;
- open the PR with `gh pr create`, whose body holds the summary, testing and known gaps, ending with
  the PR attribution line from the system rules;
- stack it on another open feature branch if this one depends on it;
- log `ship | done` with the PR URL.

## Hard rules
- Only you run git writes, push, `gh`, `AskUserQuestion`, and constitution edits.
- Never start, stop or restart the user's compose stack, and never use `docker-compose.prod.yml`.
  The user may be running production from it.
- Two user checkpoints only, plus clarify questions and genuine blockers. Don't ask the user for
  permission between phases.
- Keep every message to the user short: what phase you're in, and what's next.
