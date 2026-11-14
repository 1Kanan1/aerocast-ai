/** The answer contract from the explanation layer. */

export interface Claim {
  text: string
  refs: string[]
}

export interface Answer {
  summary: string
  claims: Claim[]
  caveats: string[]
  refusal: string | null
  notice: string | null
  /** The model that wrote it, and how long the whole answer took. Absent on
   *  a refusal or the template fallback. */
  model: string | null
  elapsedMs: number | null
}
