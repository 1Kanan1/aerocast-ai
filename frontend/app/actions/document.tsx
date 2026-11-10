import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'
import { ImportMap } from 'remix/component/server'

import { scriptEntry } from '#app/assets.ts'

export interface DocumentProps {
  children?: RemixNode
  head?: RemixNode
  title?: string
}

const DEFAULT_TITLE = readAppDisplayName('AeroCast%20AI')

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    let { children, head, title = DEFAULT_TITLE } = handle.props
    let { href, importMap, preloads } = scriptEntry

    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="dark" />
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link rel="stylesheet" href="/vendor/maplibre/maplibre-gl.css" />
          <style>
            {`@keyframes rmx-card-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes rmx-card-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(6px); }
}
@keyframes rmx-pop-in {
  from { opacity: 0; transform: translate(-50%, -6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
@keyframes rmx-pop-out {
  from { opacity: 1; transform: translate(-50%, 0); }
  to { opacity: 0; transform: translate(-50%, -6px); }
}
@keyframes rmx-thread-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes rmx-thread-pulse {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 1; }
}
@keyframes rmx-word-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes rmx-wind-flow {
  0% { transform: translate(0, 0); opacity: 0.2; }
  20% { opacity: 0.9; }
  80% { opacity: 0.9; }
  100% { transform: translate(var(--wind-x, 0px), var(--wind-y, 0px)); opacity: 0.2; }
}
.rmx-wind-arrow {
  animation-name: rmx-wind-flow;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
@media (prefers-reduced-motion: reduce) {
  .rmx-wind-arrow { animation: none; opacity: 0.8; }
}`}
          </style>
          <title>{title}</title>
          {head}
          <ImportMap value={importMap} />
          {preloads.map((preloadHref) => (
            <link key={preloadHref} rel="modulepreload" href={preloadHref} />
          ))}
          <script type="module" src={href}></script>
        </head>
        <body mix={css({ margin: 0 })}>{children}</body>
      </html>
    )
  }
}

function readAppDisplayName(value: string): string {
  return value.startsWith('%%') ? 'Remix App' : decodeURIComponent(value)
}
