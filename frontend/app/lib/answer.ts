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
}
