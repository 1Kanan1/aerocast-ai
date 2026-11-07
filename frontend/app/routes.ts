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
  /** Same-origin JSON proxy for the map island. */
  layers: get('/api/map/layers'),
  /** Same-origin JSON proxy for the station popup. */
  brief: get('/api/stations/:icao/brief'),
})
