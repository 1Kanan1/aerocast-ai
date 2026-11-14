import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { AskHistory } from './ask-history.ts'

describe('ask history', () => {
  it('keeps questions oldest first', () => {
    let history = new AskHistory()
    history.clear()

    history.record('What is the ceiling?')
    history.record('What is the wind?')

    assert.deepEqual(history.items, [
      'What is the ceiling?',
      'What is the wind?',
    ])
  })

  it('ignores blanks and keeps one entry per question', () => {
    let history = new AskHistory()
    history.clear()

    history.record('What is the wind?')
    history.record('   ')
    history.record('What is the wind?')

    assert.deepEqual(history.items, ['What is the wind?'])
  })

  it('moves a question asked again to the newest end', () => {
    let history = new AskHistory()
    history.clear()

    history.record('What is the wind?')
    history.record('What is the ceiling?')
    history.record('What is the wind?')

    assert.deepEqual(history.items, [
      'What is the ceiling?',
      'What is the wind?',
    ])
  })

  it('keeps the newest fifty', () => {
    let history = new AskHistory()
    history.clear()

    for (let index = 0; index < 55; index += 1) {
      history.record(`question ${index}`)
    }

    assert.equal(history.items.length, 50)
    assert.equal(history.items[0], 'question 5')
    assert.equal(history.items.at(-1), 'question 54')
  })

  it('hands the list to the next instance through storage', () => {
    let store = new Map<string, string>()
    let original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    })

    try {
      let first = new AskHistory()
      first.clear()
      first.record('What is the visibility?')

      let second = new AskHistory()
      assert.deepEqual(second.items, ['What is the visibility?'])
    } finally {
      if (original === undefined) {
        delete (globalThis as { localStorage?: unknown }).localStorage
      } else {
        Object.defineProperty(globalThis, 'localStorage', original)
      }
    }
  })
})
