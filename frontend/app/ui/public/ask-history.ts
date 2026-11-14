/**
 * The composer's own memory: the questions this browser has asked, newest
 * last. It is not the thread — a question asked on one station is worth
 * recalling on another, so the list outlives the selection and the page.
 */
const STORAGE_KEY = 'aerocast.ask-history'
const LIMIT = 50

function stored(): string[] {
  try {
    let raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (raw === null || raw === undefined) return []
    let parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is string => typeof item === 'string' && item !== '',
    )
  } catch {
    return []
  }
}

export class AskHistory {
  #items: string[] = stored()

  /** Oldest first, so recalling walks backwards from the end. */
  get items(): readonly string[] {
    return this.#items
  }

  /**
   * Remember a question once. Asking it again moves it to the newest end, so
   * the last press of the up arrow is always the question just sent.
   */
  record(question: string): void {
    let text = question.trim()
    if (text === '') return

    let seen = this.#items.indexOf(text)
    if (seen !== -1) this.#items.splice(seen, 1)
    this.#items.push(text)

    if (this.#items.length > LIMIT) {
      this.#items.splice(0, this.#items.length - LIMIT)
    }
    this.#save()
  }

  clear(): void {
    this.#items = []
    this.#save()
  }

  #save(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.#items))
    } catch {
      // A browser with storage disabled still gets recall within the page.
    }
  }
}

export const askHistory = new AskHistory()
