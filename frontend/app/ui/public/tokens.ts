/**
 * Global :root design tokens for dark and light themes, FAA flight categories,
 * and shared motion primitives.
 */

const DARK_VARS = `
  --paper: #0b0c0e;
  --paper-2: #121418;
  --paper-3: #1b1e24;
  --ink-0: #f3f4f6;
  --ink-1: #d4d7dd;
  --ink-2: #9ea4b0;
  --ink-3: #848b99;
  --line: rgba(255, 255, 255, 0.12);
  --line-strong: rgba(255, 255, 255, 0.24);
  --glass: rgba(18, 20, 25, 0.78);
  --glass-strong: rgba(18, 20, 25, 0.92);
  --glass-border: rgba(255, 255, 255, 0.13);
  --hover-bg: rgba(255, 255, 255, 0.07);
  --shadow: 0 20px 56px rgba(0, 0, 0, 0.52);
  --accent: #38bdf8;
  --accent-soft: rgba(56, 189, 248, 0.13);
  --accent-ink: #06131c;
  --vfr-bg: #133524;
  --vfr-ink: #6ee7b7;
  --vfr-dot: #22c55e;
  --mvfr-bg: #142a4a;
  --mvfr-ink: #93c5fd;
  --mvfr-dot: #3b82f6;
  --ifr-bg: #45181b;
  --ifr-ink: #fca5a5;
  --ifr-dot: #ef4444;
  --lifr-bg: #3f163c;
  --lifr-ink: #f5a3f5;
  --lifr-dot: #d946ef;
  --warn-bg: rgba(217, 119, 6, 0.16);
  --warn-border: rgba(245, 158, 11, 0.45);
  --warn-ink: #fcd34d;
  --danger-bg: rgba(220, 38, 38, 0.16);
  --danger-border: rgba(248, 113, 113, 0.45);
  --danger-ink: #fca5a5;
  --ctrl-filter: invert(1);
  --scrollbar-track: #121418;
  --scrollbar-thumb: #4b5262;
  --selection-bg: rgba(56, 189, 248, 0.28);
`

const LIGHT_VARS = `
  --paper: #f4f6f9;
  --paper-2: #ffffff;
  --paper-3: #e8ecf2;
  --ink-0: #111318;
  --ink-1: #262a33;
  --ink-2: #484f5e;
  --ink-3: #575f70;
  --line: rgba(17, 19, 24, 0.13);
  --line-strong: rgba(17, 19, 24, 0.25);
  --glass: rgba(255, 255, 255, 0.84);
  --glass-strong: rgba(255, 255, 255, 0.95);
  --glass-border: rgba(17, 19, 24, 0.14);
  --hover-bg: rgba(17, 19, 24, 0.06);
  --shadow: 0 14px 40px rgba(17, 19, 24, 0.14);
  --accent: #0369a1;
  --accent-soft: rgba(3, 105, 161, 0.10);
  --accent-ink: #ffffff;
  --vfr-bg: #dcfce7;
  --vfr-ink: #14532d;
  --vfr-dot: #16a34a;
  --mvfr-bg: #dbeafe;
  --mvfr-ink: #1e3a8a;
  --mvfr-dot: #2563eb;
  --ifr-bg: #fee2e2;
  --ifr-ink: #7f1d1d;
  --ifr-dot: #dc2626;
  --lifr-bg: #fae8ff;
  --lifr-ink: #701a75;
  --lifr-dot: #c026d3;
  --warn-bg: #fef3c7;
  --warn-border: #d97706;
  --warn-ink: #78350f;
  --danger-bg: #fee2e2;
  --danger-border: #dc2626;
  --danger-ink: #7f1d1d;
  --ctrl-filter: none;
  --scrollbar-track: #e8ecf2;
  --scrollbar-thumb: #94a3b8;
  --selection-bg: rgba(3, 105, 161, 0.2);
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
:root:has(> head > meta[name="color-scheme"][content="dark"]) {
  color-scheme: dark;
  ${DARK_VARS}
}
:root:has(> head > meta[name="color-scheme"][content="light"]) {
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
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
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
  0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.45); }
  60% { box-shadow: 0 0 0 6px rgba(56, 189, 248, 0); }
  100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
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
