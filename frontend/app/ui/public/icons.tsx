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

export function ChevronIcon(_handle: Handle) {
  return () => (
    <svg
      aria-hidden="true"
      fill="none"
      height="12"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      viewBox="0 0 24 24"
      width="12"
    >
      <path d="m6 15 6-6 6 6" />
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

export function SpeechIcon(_handle: Handle) {
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
      <path d="M4 5h16v11H8l-4 3V5Z" />
      <path d="M8 9.5h8M8 13h5" />
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

export function StopIcon(_handle: Handle) {
  return () => (
    <svg aria-hidden="true" height="14" viewBox="0 0 14 14" width="14">
      <rect fill="currentColor" height="10" rx="2" width="10" x="2" y="2" />
    </svg>
  )
}

export function PencilIcon(_handle: Handle) {
  return () => (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.6"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M4 20h4l10-10-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  )
}

export function CopyIcon(_handle: Handle) {
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
      <rect height="12" rx="2" width="12" x="8" y="8" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </svg>
  )
}

export function RefreshIcon(_handle: Handle) {
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
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

export function CheckIcon(_handle: Handle) {
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
      <path d="m5 12 5 5L20 7" />
    </svg>
  )
}
