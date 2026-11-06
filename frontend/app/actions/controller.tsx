import type { Handle } from 'remix/component'
import { css } from 'remix/component'
import { createController } from 'remix/router'

import { assets } from '../assets.ts'
import type { Answer } from '../lib/answer.ts'
import {
  apiAsk,
  apiGetBrief,
  apiGetHealth,
  apiGetHistory,
  apiGetStation,
} from '../lib/api.ts'
import { routes } from '../routes.ts'
import { AnswerView } from '../ui/answer.tsx'
import { cardStyle, headingStyle, mutedStyle, Page } from '../ui/layout.tsx'
import { HomePage } from './home-page.tsx'
import { StationPage } from './station-page.tsx'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (await assets.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
    },

    async home(context) {
      let health = await apiGetHealth(context.request.signal)
      return context.render(<HomePage health={health} />)
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

    async ask(context) {
      let icao = context.params.icao.toUpperCase()
      let form = await context.request.formData()
      let question = String(form.get('question') ?? '').trim()
      let wantsJson = (context.request.headers.get('accept') ?? '').includes(
        'application/json',
      )

      if (question === '') {
        if (wantsJson) {
          return Response.json({ error: 'Ask a question first.' }, { status: 400 })
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
