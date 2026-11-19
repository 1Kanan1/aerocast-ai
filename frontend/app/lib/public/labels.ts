import type { BundleMetar, BundlePeriod } from '#app/lib/api-types.ts'
import { ageLabel } from '#app/lib/format.ts'

/** Fact labels shared by the station page and the map popup. */

export interface ReportFields {
  altimeter_in_hg: number | null
  wind: {
    direction_deg: number | null
    speed_kt: number | null
    gust_kt: number | null
    is_variable: boolean
    is_calm: boolean
  } | null
  visibility: {
    statute_miles: number | null
    is_greater_than: boolean
    is_less_than: boolean
  } | null
  ceiling: { ft: number | null }
  clouds: { cover: string; base_ft: number | null }[]
  temperature: {
    c: number | null
    dewpoint_c: number | null
    dewpoint_spread_c: number | null
  } | null
  weather: string[]
}

/** The one line that stands for a report: category, wind, visibility, etc. */
export function reportLabel(facts: BundleMetar): string {
  return [
    facts.flight_category.value ?? 'no category',
    windLabel(facts),
    visibilityLabel(facts),
    ceilingLabel(facts),
    ageLabel(facts.age_seconds),
  ].join(' · ')
}

export function windLabel(facts: ReportFields): string {
  let wind = facts.wind
  if (wind === null) return 'not reported'
  if (wind.is_calm) return 'calm'
  let direction = wind.is_variable ? 'variable' : `${wind.direction_deg}°`
  let gust = wind.gust_kt === null ? '' : ` gusting ${wind.gust_kt} kt`
  return `${direction} at ${wind.speed_kt} kt${gust}`
}

export function visibilityLabel(facts: ReportFields): string {
  let visibility = facts.visibility
  if (visibility === null || visibility.statute_miles === null) {
    return 'not reported'
  }
  let qualifier = visibility.is_greater_than
    ? 'more than '
    : visibility.is_less_than
      ? 'less than '
      : ''
  return `${qualifier}${visibility.statute_miles} SM`
}

export function ceilingLabel(facts: ReportFields): string {
  return facts.ceiling.ft === null
    ? 'no ceiling'
    : `${facts.ceiling.ft.toLocaleString()} ft`
}

export function cloudsLabel(facts: ReportFields): string {
  if (facts.clouds.length === 0) return 'clear'
  return facts.clouds
    .map((cloud) =>
      cloud.base_ft === null
        ? cloud.cover
        : `${cloud.cover} ${cloud.base_ft.toLocaleString()} ft`,
    )
    .join(', ')
}

export function temperatureLabel(facts: ReportFields): string {
  let temperature = facts.temperature
  if (temperature === null || temperature.c === null) return 'not reported'

  let dewpoint =
    temperature.dewpoint_c === null
      ? 'not reported'
      : `${temperature.dewpoint_c} °C`
  let spread =
    temperature.dewpoint_spread_c === null
      ? ''
      : `, spread ${temperature.dewpoint_spread_c} °C`

  return `${temperature.c} °C / dewpoint ${dewpoint}${spread}`
}

export function periodWindLabel(period: BundlePeriod): string {
  let wind = period.wind
  if (wind === null) return '—'
  let gust = wind.gust_kt === null ? '' : ` gusting ${wind.gust_kt}`
  return `${wind.direction_deg ?? 'VRB'}° at ${wind.speed_kt} kt${gust}`
}
