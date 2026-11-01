import { createController } from 'remix/router'

import { assets } from '../assets.ts'
import { apiGetHealth } from '../lib/api.ts'
import { routes } from '../routes.ts'
import { HomePage } from './home-page.tsx'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (await assets.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
    },
    async home(context) {
      let health = await apiGetHealth(context.request.signal)
      return context.render(<HomePage health={health} />)
    },
  },
})
