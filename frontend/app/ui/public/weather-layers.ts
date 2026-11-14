import { TypedEventTarget } from 'remix/component'

/** Which weather layers the reader has switched on. */
export interface WeatherLayerState {
  rain: boolean
  temp: boolean
  wind: boolean
  advisories: boolean
}

/**
 * The key and the sketch are separate islands, so the switches live here
 * rather than inside either one. The three field layers start on; hazard
 * advisories start off, they cover whole states at a time.
 */
export class WeatherLayers extends TypedEventTarget<{ change: Event }> {
  rain = true
  temp = true
  wind = true
  advisories = false

  toggle(name: keyof WeatherLayerState): void {
    this[name] = !this[name]
    this.dispatchEvent(new Event('change'))
  }
}

export const weatherLayers = new WeatherLayers()
