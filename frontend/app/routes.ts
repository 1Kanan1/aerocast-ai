import { get, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
  station: get('/stations/:icao'),
  ask: post('/stations/:icao/ask'),
  /** Same-origin JSON proxy for the map island. */
  layers: get('/api/map/layers'),
})
