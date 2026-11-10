import type { Handle } from 'remix/component'
import { css } from 'remix/component'
import { createController } from 'remix/router'

import { assets } from '#app/assets.ts'
import type { Answer } from '#app/lib/answer.ts'
import {
  apiAsk,
  apiGetAdvisories,
  apiGetBrief,
  apiGetHealth,
  apiGetHistory,
  apiGetMapLayers,
  apiGetResolve,
  apiGetStation,
  apiGetStations,
} from '#app/lib/api.ts'
import { routes } from '#app/routes.ts'
import { AnswerView } from '#app/ui/answer.tsx'
import { cardStyle, headingStyle, mutedStyle, Page } from '#app/ui/layout.tsx'
import { AboutPage } from './about-page.tsx'
import { AdvisoriesPage } from './advisories-page.tsx'
import { StationPage } from './station-page.tsx'
import { MapShell } from '#app/ui/map-shell.tsx'

/** Roughly the continental US, which is the default map view. */
const CONUS_BBOX = '-125,24,-66,50'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (
        (await assets.fetch(context.request)) ??
        new Response('Not Found', { status: 404 })
      )
    },

    async home(context) {
      let query = context.url.searchParams.get('q') ?? ''
      let signal = context.request.signal
      let [stations, layers] = await Promise.all([
        apiGetStations(query, signal),
        apiGetMapLayers(CONUS_BBOX, signal),
      ])

      return context.render(
        <MapShell layers={layers} query={query} stations={stations} />,
      )
    },

    async station(context) {
      let icao = context.params.icao.toUpperCase()
      let signal = context.request.signal
      let [detail, brief, history] = await Promise.all([
        apiGetStation(icao, signal),
        apiGetBrief(icao, signal),
        apiGetHistory(icao, 48, signal),
      ])

      if (!detail.ok || !detail.data) {
        if (detail.status === 404) {
          return context.render(
            <MessagePage
              message={`${icao} is not in the station list.`}
              title="Unknown station"
            />,
            { status: 404 },
          )
        }

        return context.render(
          <MessagePage
            message="The API is unavailable right now, so this station cannot be read."
            title="Station unavailable"
          />,
          { status: 503 },
        )
      }

      return context.render(
        <StationPage
          askHref={routes.ask.href({ icao })}
          brief={brief}
          detail={detail.data}
          history={history}
        />,
      )
    },

    async advisories(context) {
      let advisories = await apiGetAdvisories(context.request.signal)
      return context.render(<AdvisoriesPage advisories={advisories} />)
    },

    async about(context) {
      let health = await apiGetHealth(context.request.signal)
      return context.render(<AboutPage health={health} />)
    },

    async layers(context) {
      let result = await apiGetMapLayers(
        context.url.searchParams.get('bbox'),
        context.request.signal,
      )

      if (!result.ok || !result.data) {
        return Response.json(
          { error: 'layer data is unavailable' },
          { status: 502 },
        )
      }

      return Response.json(result.data, {
        headers: { 'cache-control': 'no-store' },
      })
    },

    async search(context) {
      let result = await apiGetStations(
        context.url.searchParams.get('q') ?? '',
        context.request.signal,
      )

      if (!result.ok || !result.data) {
        return Response.json(
          { error: 'search is unavailable' },
          { status: 502 },
        )
      }

      return Response.json(result.data, {
        headers: { 'cache-control': 'no-store' },
      })
    },

    async resolve(context) {
      let result = await apiGetResolve(
        context.url.searchParams.get('q') ?? '',
        context.request.signal,
      )

      if (!result.ok || !result.data) {
        return Response.json(
          { error: 'the resolver is unavailable' },
          { status: 502 },
        )
      }

      return Response.json(result.data, {
        headers: { 'cache-control': 'no-store' },
      })
    },

    async brief(context) {
      let result = await apiGetBrief(
        context.params.icao.toUpperCase(),
        context.request.signal,
      )

      if (!result.ok || !result.data) {
        return Response.json(
          { error: 'station facts are unavailable' },
          { status: 502 },
        )
      }

      return Response.json(result.data, {
        headers: { 'cache-control': 'no-store' },
      })
    },

    async detail(context) {
      let result = await apiGetStation(
        context.params.icao.toUpperCase(),
        context.request.signal,
      )

      if (!result.ok || !result.data) {
        return Response.json(
          { error: 'station is unavailable' },
          { status: 502 },
        )
      }

      return Response.json(result.data, {
        headers: { 'cache-control': 'no-store' },
      })
    },

    async history(context) {
      let result = await apiGetHistory(
        context.params.icao.toUpperCase(),
        48,
        context.request.signal,
      )

      if (!result.ok || !result.data) {
        return Response.json(
          { error: 'station history is unavailable' },
          { status: 502 },
        )
      }

      return Response.json(result.data, {
        headers: { 'cache-control': 'no-store' },
      })
    },

    async ask(context) {
      let icao = context.params.icao.toUpperCase()
      let form = await context.request.formData()
      let question = String(form.get('question') ?? '').trim()
      let wantsJson = (context.request.headers.get('accept') ?? '').includes(
        'application/json',
      )

      if (question === '') {
        if (wantsJson) {
          return Response.json(
            { error: 'Ask a question first.' },
            { status: 400 },
          )
        }

        return context.render(
          <MessagePage
            message="Ask a question first."
            title="Nothing to answer"
          />,
          { status: 400 },
        )
      }

      let result = await apiAsk(icao, question, context.request.signal)
      let answer: Answer | null = null
      let problem: string | null = null
      let refusal: string | null = null

      if (result.ok && result.data) {
        if (result.data.refusal) refusal = result.data.refusal
        else answer = result.data
      } else {
        problem = 'The explanation layer is not available right now.'
      }

      if (wantsJson) {
        if (problem !== null) {
          return Response.json({ error: problem }, { status: 503 })
        }

        return Response.json(result.data)
      }

      return context.render(
        <Page active="map" title={`Ask · ${icao}`}>
          <section mix={cardStyle}>
            <h1 mix={headingStyle}>Answer for {icao}</h1>
            <AnswerView answer={answer} problem={problem} refusal={refusal} />
            <p mix={backStyle}>
              <a href={routes.station.href({ icao })}>Back to {icao}</a>
            </p>
          </section>
        </Page>,
        { status: problem === null ? 200 : 503 },
      )
    },
  },
})

function MessagePage(handle: Handle<{ message: string; title: string }>) {
  return () => (
    <Page active="map" title={`${handle.props.title} · AeroCast AI`}>
      <section mix={cardStyle}>
        <h1 mix={headingStyle}>{handle.props.title}</h1>
        <p mix={mutedStyle}>{handle.props.message}</p>
        <p mix={backStyle}>
          <a href={routes.home.href()}>← All stations</a>
        </p>
      </section>
    </Page>
  )
}

const backStyle = css({
  marginBlockStart: '16px',
  '& a': { color: 'var(--ink-2)' },
})
