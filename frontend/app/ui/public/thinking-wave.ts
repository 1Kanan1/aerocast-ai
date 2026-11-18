/**
 * The pending label and the brightness wave that travels along it.
 *
 * Letters never move: one crest of colour and glow passes left to right, then
 * the line rests before the next pass. The keyframes and the per-letter delays
 * are generated here from the same timings, so the crest stays in step with
 * the letters whatever the cycle is tuned to.
 */
export const THINKING_LABEL = 'Thinking'

export const THINKING_LETTERS = Array.from(THINKING_LABEL)

/** Time between one letter's crest and the next. */
const STEP_MS = 150

/**
 * The crest spans five letter steps, so several neighbours are always mid-rise
 * or mid-fall. A crest no wider than the step would light one letter at a time
 * and the line would dim in between, which reads as a pause per letter rather
 * than one smooth pass.
 */
const CREST_MS = STEP_MS * 5

/** Quiet time after the crest leaves the last letter. */
const HOLD_MS = 900

export const THINKING_CYCLE_MS =
  CREST_MS + (THINKING_LETTERS.length - 1) * STEP_MS + HOLD_MS

export function thinkingDelay(index: number): string {
  return `${index * STEP_MS}ms`
}

function percentOfCycle(ms: number): string {
  return `${((ms / THINKING_CYCLE_MS) * 100).toFixed(2)}%`
}

export const THINKING_KEYFRAMES = `@keyframes rmx-thinking-wave {
  0%, 100% { color: var(--ink-3); text-shadow: none; }
  ${percentOfCycle(CREST_MS / 2)} { color: var(--ink-2); text-shadow: 0 0 4px currentColor; }
  ${percentOfCycle(CREST_MS)} { color: var(--ink-3); text-shadow: none; }
}`
