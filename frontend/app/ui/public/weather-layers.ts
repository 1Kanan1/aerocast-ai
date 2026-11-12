import { TypedEventTarget } from 'remix/component'

/** Which weather layers the reader has switched on. All start on. */
export interface WeatherLayerState {
  rain: boolean
  temp: boolean
  wind: boolean
}

/**
 * The key and the sketch are separate islands, so the switches live here
 * rather than inside either one.
 */
export class WeatherLayers extends TypedEventTarget<{ change: Event }> {
  rain = true
  temp = true
  wind = true

  toggle(name: keyof WeatherLayerState): void {
    this[name] = !this[name]
    this.dispatchEvent(new Event('change'))
  }
}

export const weatherLayers = new WeatherLayers()
