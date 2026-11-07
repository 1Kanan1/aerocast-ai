import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { Answer } from '#app/lib/answer.ts'

interface AnswerViewProps {
  answer: Answer | null
  problem: string | null
  refusal: string | null
}

/** Shared by the island and the no-JavaScript POST response. */
export function AnswerView(handle: Handle<AnswerViewProps>) {
  return () => {
    let { answer, problem, refusal } = handle.props

    if (refusal !== null) {
      return (
        <div mix={refusalStyle} role="alert">
          <p mix={leadStyle}>{refusal}</p>
          <p mix={plainStyle}>
            AeroCast explains weather. It does not decide whether a flight is
            safe.
          </p>
        </div>
      )
    }

    if (problem !== null) {
      return (
        <p mix={problemStyle} role="alert">
          {problem}
        </p>
      )
    }

    if (answer === null) return null

    return (
      <div mix={answerStyle}>
        <p mix={leadStyle}>{answer.summary}</p>
        <ul mix={claimsStyle}>
          {answer.claims.map((claim) => (
            <li key={claim.text}>
              <span>{claim.text}</span>
              <span mix={refsStyle}>{claim.refs.join(' · ')}</span>
            </li>
          ))}
        </ul>
        {answer.caveats.length === 0 ? null : (
          <ul mix={caveatsStyle}>
            {answer.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }
}

const answerStyle = css({ marginBlockStart: '16px' })

const leadStyle = css({ margin: '0 0 10px' })

const plainStyle = css({ margin: 0, fontSize: '12px' })

const claimsStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  '& li': {
    padding: '8px 0',
    borderBlockEnd: '1px solid var(--line)',
  },
})

const refsStyle = css({
  display: 'block',
  marginBlockStart: '2px',
  fontSize: '11px',
  color: 'var(--ink-3)',
})

const caveatsStyle = css({
  margin: '10px 0 0',
  paddingInlineStart: '18px',
  fontSize: '12px',
  color: 'var(--ink-2)',
})

const refusalStyle = css({
  marginBlockStart: '16px',
  padding: '10px 12px',
  border: '1px solid var(--accent)',
  borderRadius: '6px',
})

const problemStyle = css({
  marginBlockStart: '16px',
  fontSize: '12px',
  color: 'var(--accent)',
})
