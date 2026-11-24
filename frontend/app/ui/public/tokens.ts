/**
 * Global :root design tokens for restrained dark and light themes,
 * desaturated FAA flight categories, and shared motion curves.
 */

const DARK_VARS = `
  --paper: #09090b;
  --paper-2: #111214;
  --paper-3: #1a1b1f;
  --ink-0: #f2f2f0;
  --ink-1: #d4d4d0;
  --ink-2: #9b9b96;
  --ink-3: #767672;
  --line: rgba(255, 255, 255, 0.11);
  --line-strong: rgba(255, 255, 255, 0.22);
  --glass: rgba(17, 18, 20, 0.78);
  --glass-strong: rgba(17, 18, 20, 0.93);
  --glass-border: rgba(255, 255, 255, 0.11);
  --hover-bg: rgba(255, 255, 255, 0.06);
  --shadow: 0 20px 56px rgba(0, 0, 0, 0.52);
  --accent: #e8e8e4;
  --accent-soft: rgba(255, 255, 255, 0.06);
  --accent-ink: #09090b;
  --focus-ring: rgba(242, 242, 240, 0.42);
  --vfr-bg: rgba(74, 150, 106, 0.16);
  --vfr-ink: #88bf9e;
  --vfr-dot: #5a9e76;
  --mvfr-bg: rgba(88, 128, 184, 0.16);
  --mvfr-ink: #90b0d8;
  --mvfr-dot: #5f87be;
  --ifr-bg: rgba(186, 88, 88, 0.16);
  --ifr-ink: #d69292;
  --ifr-dot: #bf6363;
  --lifr-bg: rgba(156, 96, 156, 0.16);
  --lifr-ink: #c79bc7;
  --lifr-dot: #a66ca6;
  --warn-bg: rgba(186, 138, 62, 0.12);
  --warn-border: rgba(186, 138, 62, 0.30);
  --warn-ink: #c9a66b;
  --danger-bg: rgba(186, 82, 82, 0.12);
  --danger-border: rgba(186, 82, 82, 0.32);
  --danger-ink: #d49090;
  --ctrl-filter: invert(1);
  --scrollbar-track: #111214;
  --scrollbar-thumb: #3c3e45;
  --selection-bg: rgba(242, 242, 240, 0.18);
`

const LIGHT_VARS = `
  --paper: #f3f3f1;
  --paper-2: #fafaf9;
  --paper-3: #e7e7e4;
  --ink-0: #141416;
  --ink-1: #2c2c30;
  --ink-2: #55555c;
  --ink-3: #71717a;
  --line: rgba(20, 20, 22, 0.12);
  --line-strong: rgba(20, 20, 22, 0.24);
  --glass: rgba(250, 250, 249, 0.84);
  --glass-strong: rgba(250, 250, 249, 0.95);
  --glass-border: rgba(20, 20, 22, 0.13);
  --hover-bg: rgba(20, 20, 22, 0.05);
  --shadow: 0 14px 40px rgba(20, 20, 22, 0.12);
  --accent: #18181b;
  --accent-soft: rgba(20, 20, 22, 0.05);
  --accent-ink: #fafaf9;
  --focus-ring: rgba(20, 20, 22, 0.32);
  --vfr-bg: rgba(45, 118, 76, 0.12);
  --vfr-ink: #1f5737;
  --vfr-dot: #367d53;
  --mvfr-bg: rgba(52, 94, 154, 0.12);
  --mvfr-ink: #224475;
  --mvfr-dot: #3f6aa8;
  --ifr-bg: rgba(162, 58, 58, 0.12);
  --ifr-ink: #7c2828;
  --ifr-dot: #ad4747;
  --lifr-bg: rgba(128, 62, 128, 0.12);
  --lifr-ink: #5e265e;
  --lifr-dot: #8c4b8c;
  --warn-bg: rgba(168, 118, 38, 0.10);
  --warn-border: rgba(168, 118, 38, 0.32);
  --warn-ink: #7d5616;
  --danger-bg: rgba(166, 56, 56, 0.10);
  --danger-border: rgba(166, 56, 56, 0.32);
  --danger-ink: #7d2525;
  --ctrl-filter: none;
  --scrollbar-track: #e7e7e4;
  --scrollbar-thumb: #a1a1aa;
  --selection-bg: rgba(20, 20, 22, 0.14);
`

export const ROOT_CSS = `
:root {
  color-scheme: light dark;
  --font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  ${LIGHT_VARS}
  accent-color: var(--accent);
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
}
@media (prefers-color-scheme: dark) {
  :root {
    ${DARK_VARS}
  }
}
:root:has(meta[name="color-scheme"][content="dark"]) {
  color-scheme: dark;
  ${DARK_VARS}
}
:root:has(meta[name="color-scheme"][content="light"]) {
  color-scheme: light;
  ${LIGHT_VARS}
}
*, *::before, *::after {
  box-sizing: border-box;
}
html, body {
  margin: 0;
  background: var(--paper);
  color: var(--ink-0);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  transition: background-color 220ms var(--ease-out), color 220ms var(--ease-out);
}
::selection {
  background: var(--selection-bg);
}
:focus-visible:not([data-focus-ring="parent"]) {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
[data-focus-ring="parent"]:focus,
[data-focus-ring="parent"]:focus-visible {
  outline: none;
}
@keyframes rmx-panel-in {
  from { opacity: 0; transform: translateX(18px) scale(0.985); }
  to { opacity: 1; transform: translateX(0) scale(1); }
}
@keyframes rmx-panel-out {
  from { opacity: 1; transform: translateX(0) scale(1); }
  to { opacity: 0; transform: translateX(14px) scale(0.985); }
}
@keyframes rmx-sheet-in {
  from { opacity: 0; transform: translateY(28px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes rmx-sheet-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(24px); }
}
@keyframes rmx-tab-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes rmx-popup-in {
  from { opacity: 0; transform: translateY(4px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes rmx-highlight-pulse {
  0% { box-shadow: 0 0 0 0 var(--focus-ring); }
  65% { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes rmx-icon-in {
  from { opacity: 0; transform: rotate(-35deg) scale(0.75); }
  to { opacity: 1; transform: rotate(0deg) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  html, body {
    transition: none;
  }
}
@supports not (scrollbar-color: auto) {
  * {
    scrollbar-width: auto;
  }
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 4px;
  }
  ::-webkit-scrollbar-track {
    background: var(--scrollbar-track);
  }
}
`
