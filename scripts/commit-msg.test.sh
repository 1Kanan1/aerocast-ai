#!/bin/sh
# Fixtures for scripts/commit-msg, so the gate cannot rot quietly.
# Run by make check.

here=$(cd "$(dirname "$0")" && pwd)
hook="$here/commit-msg"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

failures=0
cases=0

check() {
  name=$1
  want=$2
  message=$3

  cases=$((cases + 1))
  printf '%s' "$message" > "$tmp/message"

  if sh "$hook" "$tmp/message" >/dev/null 2>&1; then
    got=0
  else
    got=1
  fi

  if [ "$got" -ne "$want" ]; then
    printf 'FAIL %s: exit %s, wanted %s\n' "$name" "$got" "$want"
    failures=$((failures + 1))
  fi
}

check 'full body' 0 'feat(web): show the model

Why:
The answer named no model.

Decision:
Return the model and the wait.

Consequences:
A template answer names no model.
'

check 'subject only' 0 'fix(web): stop the panel blinking
'

check 'one section' 0 'chore: drop a dead branch

Why:
Nothing called it.
'

check 'two sections' 0 'docs: explain the chain

Why:
The order looked arbitrary.

Decision:
Record the measurements.
'

check 'comments are ignored' 0 'feat: keep comments out of the shape

# a comment after the subject

# a comment before the first label
Why:
The hook sees the file before cleanup.
'

check 'no blank line after the subject' 1 'feat: skip the blank
Why:
The blank line is part of the shape.
'

check 'text before the first label' 1 'feat: start with prose

This paragraph has no label.
'

check 'unknown label' 1 'feat: use a label we do not allow

Testing:
Ran it once.
'

check 'out of order' 1 'feat: put Decision first

Decision:
Wrong order.

Why:
This comes second.
'

check 'repeated label' 1 'feat: repeat Why

Why:
First.

Decision:
Fine.

Why:
Again.
'

check 'empty section before a label' 1 'feat: leave Why empty

Why:

Decision:
The blank closed it.
'

check 'empty section at the end' 1 'feat: leave Why empty

Why:
'

check 'trailer line' 1 'feat: add a co-author

Co-authored-by: someone <someone@example.com>
'

long_subject="feat: $(printf '%070d' 0)"
check 'long subject' 1 "$long_subject
"

long_line=$(printf '%073d' 0)
check 'long body line' 1 "feat: long line

Why:
$long_line
"

check 'merge commit' 0 "Merge branch 'main'
"

check 'not conventional' 1 'updated things
'

if [ "$failures" -ne 0 ]; then
  printf 'commit-msg tests: %s of %s failed\n' "$failures" "$cases"
  exit 1
fi

printf 'commit-msg tests: %s passed\n' "$cases"
