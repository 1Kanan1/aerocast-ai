import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import type { Answer } from '#app/lib/answer.ts'
import { AnswerView } from '#app/ui/answer.tsx'

interface AskResponse extends Partial<Answer> {
  error?: string
}

/** Intercepts the ordinary form post so the answer appears without a reload. */
export const AskPanel = clientEntry(
  import.meta.url,
  function AskPanel(handle: Handle<{ action: string }>) {
    let answer: Answer | null = null
    let refusal: string | null = null
    let problem: string | null = null
    let pending = false

    return () => (
      <div>
        <form
          action={handle.props.action}
          method="post"
          mix={on('submit', async (event, signal) => {
            event.preventDefault()
            let form = event.currentTarget
            answer = null
            problem = null
            refusal = null
            pending = true
            handle.update()

            try {
              let response = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { accept: 'application/json' },
                signal,
              })
              let payload = (await response
                .json()
                .catch(() => null)) as AskResponse | null
              if (signal.aborted) return

              if (!response.ok || payload === null) {
                problem =
                  payload?.error ??
                  'The explanation layer is not available right now.'
              } else if (payload.refusal) {
                refusal = payload.refusal
              } else if (typeof payload.summary === 'string') {
                answer = {
                  summary: payload.summary,
                  claims: payload.claims ?? [],
                  caveats: payload.caveats ?? [],
                  refusal: null,
                }
              } else {
                problem = 'The explanation layer returned an unexpected answer.'
              }
            } catch {
              if (!signal.aborted) {
                problem = 'The request failed before an answer arrived.'
              }
            } finally {
              if (!signal.aborted) {
                pending = false
                handle.update()
              }
            }
          })}
        >
          <label mix={labelStyle}>
            <span>Question</span>
            <textarea
              maxLength={400}
              name="question"
              placeholder="Why is the ceiling low at this hour?"
              required
              rows={3}
            />
          </label>
          <button disabled={pending} mix={buttonStyle} type="submit">
            {pending ? 'Asking…' : 'Ask'}
          </button>
        </form>

        <AnswerView answer={answer} problem={problem} refusal={refusal} />

        <p mix={disclaimerStyle}>
          Generated explanation. It restates only the data shown on this page,
          cannot assess your aircraft or your ratings, and never makes a
          go/no-go call.
        </p>
      </div>
    )
  },
)

const labelStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  '& span': { fontSize: '12px', color: 'var(--ink-3)' },
  '& textarea': {
    padding: '8px 10px',
    border: '1px solid var(--line)',
    borderRadius: '6px',
    background: 'var(--paper)',
    color: 'var(--ink-0)',
    font: 'inherit',
    resize: 'vertical',
  },
})

const buttonStyle = css({
  marginBlockStart: '10px',
  padding: '8px 16px',
  border: '1px solid var(--ink-0)',
  borderRadius: '6px',
  background: 'var(--ink-0)',
  color: 'var(--paper)',
  font: 'inherit',
  cursor: 'pointer',
  '&:disabled': { opacity: 0.6, cursor: 'progress' },
})

const disclaimerStyle = css({
  margin: '16px 0 0',
  paddingBlockStart: '12px',
  borderBlockStart: '1px solid var(--line)',
  fontSize: '12px',
  color: 'var(--ink-3)',
})
