import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { Answer } from '#app/lib/answer.ts'
import type { ThreadEntry } from './session.ts'
import { threadAnnouncement } from './thread-parts.tsx'

const ANSWER: Answer = {
  summary: 'KSFO is VFR.',
  claims: [],
  caveats: [],
  refusal: null,
  notice: null,
  model: 'gpt-6-luna',
  elapsedMs: 1200,
}

function entry(overrides: Partial<ThreadEntry>): ThreadEntry {
  return {
    answer: null,
    pending: false,
    problem: null,
    question: 'Is KSFO VFR?',
    refusal: null,
    stopped: false,
    ...overrides,
  }
}

describe('thread announcement', () => {
  it('names whatever the latest turn is doing', () => {
    assert.equal(threadAnnouncement(undefined), '')
    assert.equal(threadAnnouncement(entry({ pending: true })), 'Thinking')
    assert.equal(threadAnnouncement(entry({ stopped: true })), 'Stopped.')
    assert.equal(
      threadAnnouncement(entry({ refusal: 'That is not a weather question.' })),
      'That is not a weather question.',
    )
    assert.equal(
      threadAnnouncement(entry({ problem: 'The answer timed out.' })),
      'The answer timed out.',
    )
    assert.equal(threadAnnouncement(entry({ answer: ANSWER })), 'KSFO is VFR.')
  })
})
