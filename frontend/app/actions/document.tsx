import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'
import { ImportMap } from 'remix/component/server'

import { scriptEntry } from '#app/assets.ts'
import { THINKING_KEYFRAMES } from '#app/ui/public/thinking-wave.ts'
import { ROOT_CSS } from '#app/ui/public/tokens.ts'

export interface DocumentProps {
  children?: RemixNode
  head?: RemixNode
  title?: string
}

const DEFAULT_TITLE = readAppDisplayName('AeroCast%20AI')

const THEME_INIT_SCRIPT =
  `try{var t=localStorage.getItem('color-scheme');` +
  `if(t==='light'||t==='dark'){` +
  `document.querySelector('meta[name="color-scheme"]').content=t;` +
  `}}catch{}`

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    let { children, head, title = DEFAULT_TITLE } = handle.props
    let { href, importMap, preloads } = scriptEntry

    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="light dark" />
          <script>{THEME_INIT_SCRIPT}</script>
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link rel="stylesheet" href="/vendor/maplibre/maplibre-gl.css" />
          <style>
            {`${ROOT_CSS}
@keyframes rmx-card-in {
  from { opacity: 0; transform: translateY(8px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes rmx-card-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(6px) scale(0.985); }
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
${THINKING_KEYFRAMES}
@keyframes rmx-word-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
.maplibregl-popup-content {
  padding: 8px 10px !important;
  border: 1px solid var(--glass-border);
  border-radius: 10px !important;
  background: var(--glass-strong) !important;
  color: var(--ink-0) !important;
  box-shadow: var(--shadow) !important;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  font: 12px/1.45 var(--font-sans);
  animation: rmx-popup-in 180ms var(--ease-out) both;
}
.maplibregl-popup-tip { display: none; }
.maplibregl-popup-close-button {
  color: var(--ink-2);
  font-size: 16px;
  padding: 2px 6px;
}
.station-tip .station-tip-muted { color: var(--ink-3); }
.station-tip strong { font-size: 12px; font-family: var(--font-mono); }
.station-tip-head { display: flex; align-items: center; gap: 6px; }
.station-tip-cat { font-family: var(--font-mono); font-size: 10px; font-weight: 700; }
.advisory-tip { display: flex; flex-direction: column; gap: 3px; padding-inline-end: 14px; }
.advisory-tip strong { font-family: var(--font-mono); font-size: 12px; }`}
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
