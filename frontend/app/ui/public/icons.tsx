import type { Handle } from 'remix/component'

/** Inline monochrome icons: 16px, currentColor, no icon package. */

export function SearchIcon(_handle: Handle) {
  return () => (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  )
}

export function ArrowIcon(_handle: Handle) {
  return () => (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M5 12h13" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

export function CloseIcon(_handle: Handle) {
  return () => (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-width="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function AlertIcon(_handle: Handle) {
  return () => (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.6"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M12 4.5 20.5 20h-17Z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.1" />
    </svg>
  )
}

export function InfoIcon(_handle: Handle) {
  return () => (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-width="1.6"
      viewBox="0 0 24 24"
      width="16"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 8v.1" />
    </svg>
  )
}

export function SparkIcon(_handle: Handle) {
  return () => (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.5"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M11 4.5 12.5 9 17 10.5 12.5 12 11 16.5 9.5 12 5 10.5 9.5 9Z" />
      <path d="M18 15.5 18.7 17.5 20.5 18.2 18.7 18.9 18 21 17.3 18.9 15.5 18.2 17.3 17.5Z" />
    </svg>
  )
}

export function SendIcon(_handle: Handle) {
  return () => (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  )
}
