# How to ask

House style for `ask_user_question`. The point of this workflow is that decisions
are *made* by the user, not guessed by the model and discovered later.

## Hard schema limits

Violating these gets the request **rejected**, not truncated:

- 1-4 questions per call. **Ask one at a time** unless two are genuinely inseparable.
- 2-4 options per question.
- `header` — **maximum 16 characters**.
- `label` — **maximum 60 characters**.
- **Never author an option labeled `"Other"`.** It is reserved. A "Type something."
  row is appended automatically for single-select questions. Multi-select
  suppresses it, so if free text matters, do not use `multiSelect`.

## Writing a good question

- **One decision per question.** If the answer to A changes what B should be, ask A
  first.
- **Every option gets a real description**: what it means, the tradeoff, and the
  consequence. Never write a description that only restates the label.
- **Mark exactly one option `(Recommended)` and put it first.** Recommend on the
  merits and the user's known preferences, not on what is easiest to implement.
  If nothing is clearly better, say so in the recommended option's description
  rather than recommending nothing.
- **Use `preview` whenever the choice is structural.** Show the resulting file
  tree, config, schema, API shape, or UI sketch. A user picks correctly from a
  concrete artifact and badly from an abstract label.
- **Do not editorialise against an option you are still offering.** If an option is
  genuinely bad, do not list it.

## Reading the answer

The response envelope is:

```ts
{ questionIndex, question, kind: "option" | "custom" | "multi",
  answer: string | null, selected?: string[], notes?: string, preview?: string }
```

- `kind: "custom"` — the user typed free text. That is the answer. Interpret it,
  restate your interpretation in one line, and continue.
- `kind: "multi"` — read `selected`; `answer` is null.
- **`notes` are authoritative.** If a note modifies, qualifies, or contradicts the
  selected option, **the note wins**. Restate what you took from it. A note may
  itself raise new open decisions — add them to the ledger.
- **An answer with no option selected but a note attached is still an answer.**
  Do not re-ask.
- **A cancelled questionnaire is not an answer.** Do not proceed as though the
  recommended option was chosen. Ask what the user wants to do.

## Never ask

- Something already answered in `state.json`, the plan overview's Tooling
  section, or `research/codebase.md`.
- Something you can determine by reading the repo or running a command.
- Permission to continue work the user already asked for.
- A question whose options you have not researched, when the answer depends on
  external facts (library capabilities, service limits, pricing, API shape).
  Research first, then ask with real tradeoffs.

## Standing preferences

Seed recommendations with these unless the current task contradicts them:

- Professional conventions: tests, CI, typecheck and lint gates.
- A working local-dev path before anything is deployed.
- Nothing reaches infrastructure without explicit human action.
- Public-repo hygiene: no secrets, no planning docs, no build artifacts committed.
- Small, readable commits. `/skill:yeet` confirms main-vs-branch once per repo and
  remembers the answer — do not re-litigate that choice in this interview.
- Follow the conventions already in the codebase rather than introducing new ones,
  unless the user is deliberately changing direction.
