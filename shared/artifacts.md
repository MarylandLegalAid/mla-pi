# Artifacts

Everything mla-pi produces for a project lives in one gitignored directory at
the project root. It is deliberately visible next to the code, trivially copied to
another device, and covered by a single `.gitignore` line.

```
<project-root>/.pi-workflow/
├── state.json                  # the source of truth for stage and package status
├── plan/
│   ├── 00-overview.md          # goal, decisions ledger, tooling, conventions, wave plan
│   └── NN-<slug>.md            # work packages
├── research/
│   ├── codebase.md             # scout recon (brownfield)
│   └── <topic>.md              # cited web research
├── scratch/
│   └── <pkg-id>/               # throwaway probes. Gitignored, never committed.
└── log/
    ├── build-<iso8601>.md      # run summaries, costs, decisions
    └── subagent/<pkg-id>-<n>.md
```

## scratch/

Diagnostic scripts a worker writes to understand something — a selector probe, a
one-off request, a print-the-shape script — go in `scratch/<pkg-id>/`, **never
inside the package's `owns` globs**.

`owns` defines what build commits. A worker debugging a scraper by writing
`inspect_dining_vm.mjs` through `inspect_dining_vm5.mjs` into an owned directory
does not just make a mess; it makes a mess that `git add` picks up, because the
commit step stages the package's files and those files match. Scratch under
`.pi-workflow/` is covered by the same single `.gitignore` line as everything
else here, so it cannot reach a commit no matter how the globs are written.

Delete a package's scratch directory when it completes. It is evidence while the
package is in flight and litter afterwards.

## state.json

```json
{
  "version": 1,
  "project": "/abs/path",
  "updatedAt": "2026-07-21T20:00:00Z",
  "goal": "one-paragraph restatement of what the user asked for",
  "stages": {
    "plan":  { "status": "complete", "completedAt": "...", "planDir": ".pi-workflow/plan", "packages": 12 },
    "build": { "status": "in_progress", "startedAt": "..." },
    "yeet":  { "status": "not_started" }
  },
  "openDecisions": [
    {
      "id": "rate-limiting",
      "question": "How should the public API be rate limited?",
      "status": "open",
      "answer": null,
      "notes": null,
      "raisedBy": "answer to auth-strategy",
      "resolvedAt": null
    }
  ],
  "packages": {
    "03-auth-endpoints": {
      "status": "pending",
      "attempts": 0,
      "startedAt": null,
      "completedAt": null,
      "commit": null,
      "reviewer": null,
      "blockedReason": null
    }
  },
  "costUsd": 0.0,
  "yeetTarget": "main"
}
```

**Stage status:** `not_started` | `in_progress` | `complete`
**Decision status:** `open` | `resolved` | `moot`
**Package status:** `pending` | `running` | `review` | `complete` | `blocked` | `skipped`

## Rules

- **Atomic writes.** Write `state.json.tmp`, then rename over `state.json`. A
  killed subagent must never leave a truncated state file.
- **Idempotence.** Re-running a stage that is already `complete` never silently
  overwrites. Detect it and ask: resume, amend, or restart. On restart, archive the
  existing artifact (`plan.archived-<timestamp>/`) rather than deleting it.
- **The orchestrator owns state.json.** Subagents never write it. They return
  results; the parent records them. Two parallel workers writing state would race.
- **Never commit `.pi-workflow/`.** Every skill that touches git verifies
  `git check-ignore -q .pi-workflow` first. If it is ever found staged, that is a
  bug — stop and report rather than working around it.
- Nothing in `.pi-workflow/` is authoritative about the code. If the plan and the
  repo disagree, the repo is what exists; say so rather than editing the plan to
  match.
