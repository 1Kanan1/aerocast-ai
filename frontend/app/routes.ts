import { get, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
  station: get('/stations/:icao'),
  ask: post('/stations/:icao/ask'),
})
