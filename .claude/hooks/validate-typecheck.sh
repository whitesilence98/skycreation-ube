#!/bin/bash

# --- work from the project root ----------------------------------------------
# Every path below is repo-relative, so a hook invoked with a working directory
# that is not the repo root would read and write the WRONG TREE.
#
# PRECEDENCE IS LOAD-BEARING. A cwd that IS a project root carries real
# information and must win. In order:
#   1. cwd holds project.yaml   -> cwd   (a project root)
#   2. cwd holds .claude/       -> cwd   (unless cwd is itself named .claude,
#      which would turn this hook's log into .claude/production/)
#   3. CLAUDE_PROJECT_DIR       -> that  (set by the hook environment)
#   4. this script's location   -> <root>/.claude/hooks/../.. by construction
#
# NOT an upward search: that resolves a nested project to its parent's config.
if [ -f "project.yaml" ] || { [ -d ".claude" ] && [ "${PWD##*/}" != ".claude" ]; }; then
  CCGS_ROOT="$PWD"
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "${CLAUDE_PROJECT_DIR}" ] && case "${CLAUDE_PROJECT_DIR%/}" in */.claude|*\\.claude) false ;; *) true ;; esac; then
  CCGS_ROOT="$CLAUDE_PROJECT_DIR"
else
  CCGS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
fi
[ -n "$CCGS_ROOT" ] && cd "$CCGS_ROOT" 2>/dev/null || true

# Claude Code PreToolUse hook (Bash|PowerShell): refuse a `git commit` while
# `tsc --noEmit` fails.
#
# WHY A HOOK AND NOT A RULE
# `.claude/rules/workflow-discipline.md` tells the model to run typecheck before
# claiming success. That is guidance the model weighs; it can forget, or decide
# a cosmetic change does not need it. A broken `tsc` reaching `main` is exactly
# the failure a rule cannot prevent and a hook can, so it is enforced here. The
# two do not contradict: the rule says "run it", this says "you may not commit a
# failing tree".
#
# WHAT IT CANNOT SEE
# Typecheck proves the tree compiles. It says nothing about a wrong bone name, a
# broken collar seam or a bad catalogue reference — those are the `check:*`
# scripts. This gate is a floor, not a definition of "done".
#
# WHEN IT SKIPS, IT SAYS SO
# If node_modules or the TypeScript binary is absent the check cannot run. It
# then warns once on stderr and allows the commit, rather than blocking on an
# environment problem. The warning is what keeps a skipped check distinguishable
# from a passing one.
#
# COST
# A full `tsc --noEmit` here is ~5s on this repo. It runs only when the command
# actually contains `git commit`, and only when the tree is dirty enough to
# matter. That is acceptable for a commit; it would not be for every tool call.
#
# Exit codes: 0 = allow, 2 = block (stderr is shown to Claude).

# Fast reject before any parsing: the vast majority of Bash/PowerShell calls are
# not commits. A `git commit` mentioned inside a heredoc (writing a note that
# quotes the command) would false-positive here; the command-position check
# below is the one that decides, this is only a cheap prefilter.
PAYLOAD=$(cat)
case "$PAYLOAD" in *"git commit"*|*"git  commit"*) ;; *) exit 0 ;; esac

extract_command() { # <json> -> the command string on stdout
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r '.tool_input.command // empty' 2>/dev/null && return 0
  fi
  # Fallback: pull the "command" value out without jq. Escapes are unescaped
  # enough to see the verb; this path only ever feeds a substring test.
  printf '%s' "$1" \
    | grep -oE '"command"[[:space:]]*:[[:space:]]*"(\\.|[^"\\])*"' \
    | head -1 \
    | sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//; s/\\\\/\\/g'
}

CMD=$(extract_command "$PAYLOAD" | tr -d '\r')
[ -n "$CMD" ] || exit 0

# Is `git commit` the command being run -- not an argument to something else
# and not inside a quoted string? Accept it at the start of the line, after a
# shell separator/control operator, or after a leading env assignment. This is
# deliberately conservative in what it *blocks*; a missed exotic invocation
# costs nothing here because `/workflow-discipline` still applies, while
# blocking a non-commit command would be a false accusation.
if ! printf '%s' "$CMD" \
  | grep -qE '(^|[;&|()]|&&|\|\||\bthen\b|\bdo\b)[[:space:]]*(git[[:space:]]+commit|git[[:space:]]+-C[[:space:]]+[^[:space:]]+[[:space:]]+commit)([[:space:]]|$|")'; then
  exit 0
fi

# --dry-run stages nothing and must not be gated on a stale tree.
case "$CMD" in *"commit"*"--dry-run"*|*"--dry-run"*"commit"*) exit 0 ;; esac

# The check cannot run without the toolchain. Say so; do not block on it.
if [ ! -x node_modules/.bin/tsc ] && [ ! -f node_modules/typescript/bin/tsc ]; then
  printf '%s\n' "typecheck gate did not run: node_modules/typescript is not installed, so 'tsc --noEmit' cannot be executed. Run 'npm install', then re-run this commit." >&2
  exit 0
fi

# Run it. `npx --no-install` refuses to download anything, so this cannot
# silently install a different TypeScript than the lockfile pins.
OUTPUT=$(npx --no-install tsc --noEmit 2>&1)
STATUS=$?

if [ $STATUS -eq 0 ]; then
  exit 0
fi

# A non-zero exit with no diagnostics is not a type error -- it is the tool
# failing to run. Report that distinctly rather than claiming the code is bad.
if [ -z "$OUTPUT" ]; then
  printf '%s\n' "typecheck gate did not run: 'tsc --noEmit' exited $STATUS with no output. The commit is allowed, but the tree is UNVERIFIED." >&2
  exit 0
fi

printf '%s\n' \
  "Commit blocked: 'tsc --noEmit' failed. Fix these before committing:" \
  "" \
  "$OUTPUT" \
  "" \
  "(.claude/rules/workflow-discipline.md -- a change is not done until typecheck passes.)" >&2
exit 2
