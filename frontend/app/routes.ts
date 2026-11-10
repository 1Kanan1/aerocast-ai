import { get, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
  station: get('/stations/:icao'),
  ask: post('/stations/:icao/ask'),
  advisories: '/advisories',
  about: '/about',
  /** Same-origin JSON proxy for the search popover. */
  search: get('/api/stations'),
  /** Ask-first: the station a question names, or the ones it might mean. */
  resolve: get('/api/resolve'),
  /** Same-origin JSON proxy for the map island. */
  layers: get('/api/map/layers'),
  /** Same-origin JSON proxy for the station card. */
  detail: get('/api/stations/:icao'),
  history: get('/api/stations/:icao/observations'),
  brief: get('/api/stations/:icao/brief'),
})
