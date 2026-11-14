/** Human labels for timestamps and ages. All times are UTC, like the data. */

export function ageLabel(seconds: number | null): string {
  if (seconds === null) return 'age unknown'
  if (seconds < 90) return 'just now'
  if (seconds < 5400) return `${Math.round(seconds / 60)} min old`
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h old`
  return `${Math.round(seconds / 86400)} d old`
}

export function timeLabel(value: string | null): string {
  if (!value) return 'unknown'
  let date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** "2026-11-05 21:00 UTC → 22:00 UTC" reads better than two full stamps. */
export function windowLabel(from: string, to: string): string {
  let start = timeLabel(from)
  let end = timeLabel(to)

  // A period that ends on another day keeps its date, or it reads backwards.
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${start} → ${end.slice(11)}`
    : `${start} → ${end}`
}

/** How long a model call took: fine enough to tell two fast rungs apart. */
export function tookLabel(ms: number): string {
  let seconds = ms / 1000
  if (seconds < 9.95) return `${seconds.toFixed(1)}s`

  let total = Math.round(seconds)
  if (total < 60) return `${total}s`

  let minutes = Math.floor(total / 60)
  let rest = total % 60
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}

/** A gateway model id carries its vendor twice; the model is the last part. */
export function modelLabel(model: string): string {
  let name = model.slice(model.lastIndexOf('/') + 1)
  return name === '' ? model : name
}
