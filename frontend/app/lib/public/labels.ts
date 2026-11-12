import type { BundleMetar, BundlePeriod } from '#app/lib/api-types.ts'
import { ageLabel } from '#app/lib/format.ts'

/** Fact labels shared by the station page and the map popup. */

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

export function windLabel(facts: BundleMetar): string {
  let wind = facts.wind
  if (wind === null) return 'not reported'
  if (wind.is_calm) return 'calm'
  let direction = wind.is_variable ? 'variable' : `${wind.direction_deg}°`
  let gust = wind.gust_kt === null ? '' : ` gusting ${wind.gust_kt} kt`
  return `${direction} at ${wind.speed_kt} kt${gust}`
}

export function visibilityLabel(facts: BundleMetar): string {
  let visibility = facts.visibility
  if (visibility === null) return 'not reported'
  let qualifier = visibility.is_greater_than
    ? 'more than '
    : visibility.is_less_than
      ? 'less than '
      : ''
  return `${qualifier}${visibility.statute_miles} SM`
}

export function ceilingLabel(facts: BundleMetar): string {
  return facts.ceiling.ft === null
    ? 'no ceiling'
    : `${facts.ceiling.ft.toLocaleString()} ft`
}

export function cloudsLabel(facts: BundleMetar): string {
  if (facts.clouds.length === 0) return 'clear'
  return facts.clouds
    .map((cloud) =>
      cloud.base_ft === null
        ? cloud.cover
        : `${cloud.cover} ${cloud.base_ft.toLocaleString()} ft`,
    )
    .join(', ')
}

export function temperatureLabel(facts: BundleMetar): string {
  let temperature = facts.temperature
  if (temperature === null) return 'not reported'

  let spread =
    temperature.dewpoint_spread_c === null
      ? ''
      : `, spread ${temperature.dewpoint_spread_c} °C`

  return `${temperature.c} °C / dewpoint ${temperature.dewpoint_c} °C${spread}`
}

export function periodWindLabel(period: BundlePeriod): string {
  let wind = period.wind
  if (wind === null) return '—'
  let gust = wind.gust_kt === null ? '' : ` gusting ${wind.gust_kt}`
  return `${wind.direction_deg ?? 'VRB'}° at ${wind.speed_kt} kt${gust}`
}
