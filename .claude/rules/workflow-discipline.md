# Workflow Discipline

This file deliberately carries **no `paths:` frontmatter**, so it loads every
session at the same priority as `CLAUDE.md` — that is the documented behaviour
for a rule with no path scope (`.claude/docs/rules-reference.md`, point 3). It
is deliberate: these are the rules that must hold regardless of which file is
being touched. Every line here costs context on every turn, so keep it short and
only add a rule you have wanted more than once.

## Verification — the one non-negotiable

- **Never report a change as working without running `npm run typecheck` and
  reading its output.** Quote the real result. "Should be fine" is not a
  verdict; neither is silence.
- If typecheck fails, say so plainly with the failing lines. Do not describe
  the work as complete and mention the error in passing.
- A command that did not run is reported as not run. Never let "I skipped it"
  read the same as "it passed".
- For 3D/asset work, the relevant check is the matching `npm run check:*`
  script, not typecheck alone. Typecheck cannot see a wrong bone name or a
  broken collar.

## Scope — confirm before acting

- **Explain a multi-file change before making it.** Name the files and the
  approach, then wait for confirmation. This project's `CLAUDE.md`
  Collaboration Protocol already requires this; enforce it on yourself.
- Do not "improve" adjacent code that the request did not ask about. If it is
  wrong, say so and leave it.
- Do not refactor and change behaviour in the same step. One or the other, so a
  regression is attributable.

## Git — read-only unless asked

- **Never `git commit`, `git push`, `git reset`, `git checkout -- <path>`,
  `git stash` or `git rebase` unless the user asked for that specific action.**
  "Fix the bug" is not permission to commit the fix.
- Never amend, force-push or rewrite history. Ever.
- Before any destructive git operation, state what will be lost and wait.
- Commit messages follow the repo's conventional style already in `git log`
  (`feat(scope): ...`, `fix(scope): ...`).

## Destructive operations

- Read a file before overwriting or deleting it. State what is being removed.
- Never delete a directory tree to "clean up". Name the files.
- Never edit files under `public/assets/mo2/` or `public/assets/preset-pack/` —
  they are generated and gitignored, and a hand edit is lost on the next
  `npm run sync:*`. Change the sync script or the source pack instead.
  (Enforced by `permissions.deny` in `.claude/settings.json`.)

## Honesty about uncertainty

- If a fact about the code, an asset or a measurement is not verified in this
  session, say it is unverified. Do not present an inference as a measurement.
- A recalled memory reflects what was true when written. Re-check any file path,
  line number or count before relying on it.
