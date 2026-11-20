# Code Review

Follow these guidelines when preparing changes for human review.

## 1. Automated Validation

Run all applicable deterministic checks:
- Formatting, linting, type checking.
- Unit and integration tests.
- Mutation testing.
- Security and dependency scanning.

Never claim a check passed if it wasn't executed.

## 2. Review Preparation

Before presenting the changes, analyze:

- Behavioral vs. structural changes.
- Risk level and affected components.
- Changed interfaces and their consumers.
- System invariants and potential regressions.
- Security-sensitive operations.

## 3. Human Review Brief

Produce a triage brief so the reader knows what to open and what to skip.
Do not repeat the same issue across sections.

Maximum output: 8 lines total.

Format:

### Review: `<short-hash>` - `<commit-subject>`

- **Read:** Up to 3-4 `file:lines` bullets. One short clause per bullet
  naming the bug, risk, or design call to judge. Prefix confirmed bugs
  with `[bug]`.
- **Skip:** One line listing remaining changed files that are mechanical
  or low-risk. Omit if every file is in Read.
- **Unchecked:** One line for failed, skipped, or unrunnable checks.
  Never list passing checks. Omit if all checks passed.

Prioritize behavioral changes over structural changes.

## 4. Five Review Dimensions

Use these dimensions to prioritize what humans should inspect:

1. Tests: Do tests independently verify requirements,
   including negative and boundary cases?
2. Risk: Are security, authorization, concurrency,
   and data integrity handled correctly?
3. Blast radius: Could other components, callers,
   or interfaces be affected?
4. Invariants: What must always remain true?
   Are those properties actually enforced?
5. Adversarial review: What plausible failure scenarios
   or incorrect assumptions remain?

Do not write five separate explanations.
Surface only findings that require human attention.

## 5. Review Rules

- Never equate passing tests with correctness.
- Never hide uncertainty behind a successful summary.
- Distinguish confirmed bugs from potential issues.
- Do not ask humans to inspect formatting or other
  mechanically validated details.
- Do not omit a risky change merely to satisfy the
  output limit.

If more than four items genuinely require inspection,
prioritize them by risk and explicitly state that
additional review is needed.
