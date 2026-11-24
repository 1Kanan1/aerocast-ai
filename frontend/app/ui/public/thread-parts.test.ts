import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { Answer } from '#app/lib/answer.ts'
import type { ThreadEntry } from './session.ts'
import {
  citationLabel,
  citationTarget,
  collectCitations,
  threadAnnouncement,
} from './thread-parts.tsx'

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

describe('citations', () => {
  it('formats bundle refs into concise human labels', () => {
    assert.equal(citationLabel('metar.KSFO.wind'), 'KSFO wind')
    assert.equal(citationLabel('metar.KSFO.flight_category'), 'KSFO category')
    assert.equal(citationLabel('metar.KSFO'), 'KSFO METAR')
    assert.equal(citationLabel('taf.KSFO.period.0'), 'KSFO TAF #1')
    assert.equal(citationLabel('adv.KSFO.2'), 'KSFO advisory #3')
    assert.equal(citationLabel('custom.ref'), 'custom.ref')
  })

  it('routes refs to their matching section and field key', () => {
    assert.deepEqual(citationTarget('metar.KSFO.ceiling'), {
      section: 'conditions',
      field: 'ceiling',
    })
    assert.deepEqual(citationTarget('taf.KSFO.period.1'), {
      section: 'forecast',
      field: 'taf.KSFO.period.1',
    })
    assert.deepEqual(citationTarget('adv.KSFO.0'), {
      section: 'conditions',
      field: 'advisories',
    })
  })

  it('deduplicates refs across claims in appearance order', () => {
    let citations = collectCitations([
      {
        text: 'Visibility is 10 SM.',
        refs: ['metar.KSFO.visibility', 'metar.KSFO.flight_category'],
      },
      {
        text: 'VFR because visibility is 10 SM.',
        refs: ['metar.KSFO.visibility', 'metar.KSFO.ceiling'],
      },
    ])

    assert.deepEqual(
      citations.map((item) => item.ref),
      [
        'metar.KSFO.visibility',
        'metar.KSFO.flight_category',
        'metar.KSFO.ceiling',
      ],
    )
    assert.equal(citations[0]?.note, 'Visibility is 10 SM.')
  })
})
