import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { ThemeStore } from './theme.ts'

describe('theme store', () => {
  it('stores override when diverging from system and clears when returning', () => {
    let store = new ThemeStore(null, 'dark')
    let changes = 0
    store.addEventListener('change', () => {
      changes += 1
    })

    assert.equal(store.override, null)
    assert.equal(store.resolved, 'dark')

    assert.equal(store.toggle(), 'light')
    assert.equal(store.override, 'light')
    assert.equal(store.resolved, 'light')

    assert.equal(store.toggle(), 'dark')
    assert.equal(store.override, null)
    assert.equal(store.resolved, 'dark')
    assert.equal(changes, 2)
  })
})
