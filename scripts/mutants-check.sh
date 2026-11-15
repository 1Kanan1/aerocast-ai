#!/bin/sh
# Compare today's survivors with the checked-in baseline.
#
# A survivor is a mutant no test caught. The baseline lists the ones we
# accept; a new name means a change added behaviour nothing checks, and this
# fails. Killing a baseline survivor is progress, so it is reported without
# failing. Refresh the baseline with --update, on purpose.

root=$(cd "$(dirname "$0")/.." && pwd)
baseline="$root/backend/mutants-baseline.txt"
current=$(mktemp)
trap 'rm -f "$current"' EXIT

survivors() {
  (
    cd "$root/backend" || exit 1
    uv run mutmut results 2>/dev/null \
      | sed -n 's/.*\(app\.llm\..*\): survived/\1/p' \
      | sort
  )
}

survivors > "$current"

if [ "${1:-}" = "--update" ]; then
  survivors > "$baseline"
  printf 'mutants: baseline lists %s survivors\n' \
    "$(wc -l < "$baseline" | tr -d ' ')"
  exit 0
fi

if [ ! -f "$baseline" ]; then
  printf 'mutants: no baseline; run make mutants-baseline\n' >&2
  exit 1
fi

new=$(comm -13 "$baseline" "$current")
fixed=$(comm -23 "$baseline" "$current")

if [ -n "$new" ]; then
  printf 'mutants: %s survivor(s) not in the baseline\n\n' \
    "$(printf '%s\n' "$new" | wc -l | tr -d ' ')" >&2
  printf '%s\n' "$new" | sed 's/^/  /' >&2
  printf '\nA test is missing, or the baseline is stale on purpose.\n' >&2
  printf 'Make a survivor known only after deciding it is fine.\n' >&2
  exit 1
fi

printf 'mutants: no new survivors'
if [ -n "$fixed" ]; then
  printf ' (%s baseline entries now killed)' \
    "$(printf '%s\n' "$fixed" | wc -l | tr -d ' ')"
fi
printf '\n'
