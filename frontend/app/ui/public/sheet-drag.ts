export type SheetSnap = 'peek' | 'half' | 'full'
export type SheetDropOutcome = SheetSnap | 'dismiss'

export const MOBILE_SHEET_QUERY = '(max-width: 900px)'
export const SHEET_HALF_VH = 56
export const SHEET_PEEK_PX = 164
export const SHEET_DISMISS_PX = 96

const DRAG_THRESHOLD_PX = 6
const FLICK_VELOCITY_PX_PER_MS = 0.45

export interface CameraPadding {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Computes MapLibre camera padding so a focused station or area dot centers
 * inside the open map area rather than behind the desktop drawer or mobile
 * bottom sheet. Always returns all four edges to clear any prior padding.
 */
export function cameraPadding(
  viewportWidth: number,
  viewportHeight: number,
): CameraPadding {
  if (viewportWidth > 900) {
    return { top: 84, right: 520, bottom: 96, left: 0 }
  }
  return {
    top: 128,
    right: 0,
    bottom: Math.round(viewportHeight * (SHEET_HALF_VH / 100)),
    left: 0,
  }
}

/** Clamps a live mobile sheet height to the visible viewport. */
export function clampSheetHeight(
  heightPx: number,
  viewportHeight: number,
): number {
  let max = Math.max(0, viewportHeight)
  return Math.max(0, Math.min(max, Math.round(heightPx)))
}

/**
 * Resolves a released mobile bottom sheet into one of four stages:
 * full (100dvh), half (56dvh), peek (slightly open header + AskBar), or
 * dismiss (closed). Positive velocity is downward; negative is upward.
 */
export function resolveSheetDrop(
  heightPx: number,
  viewportHeight: number,
  velocityPxPerMs: number,
  startSnap: SheetSnap = 'half',
): SheetDropOutcome {
  if (heightPx <= SHEET_DISMISS_PX) return 'dismiss'

  let ratio = viewportHeight > 0 ? heightPx / viewportHeight : 0.5

  if (velocityPxPerMs > FLICK_VELOCITY_PX_PER_MS) {
    if (startSnap === 'full' && ratio > 0.44) return 'half'
    if (startSnap === 'peek' || heightPx <= SHEET_PEEK_PX) return 'dismiss'
    return 'peek'
  }

  if (velocityPxPerMs < -FLICK_VELOCITY_PX_PER_MS) {
    if (startSnap === 'peek' && ratio < 0.68) return 'half'
    return 'full'
  }

  if (ratio >= 0.76) return 'full'
  if (ratio < 0.44) return 'peek'
  return 'half'
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('a, button, input, textarea, select, [role="button"]') !==
      null
  )
}

export interface SheetDragOptions {
  getPanel: () => HTMLElement | undefined
  onSnap: (snap: SheetSnap) => void
  onDismiss: () => void
  signal?: AbortSignal
}

export interface SheetDragController {
  onPointerDown: (event: PointerEvent, fromHandle: boolean) => void
  consumeSuppressedClick: () => boolean
  resetInlineState: () => void
}

/**
 * Tracks vertical pointer dragging on mobile bottom sheets directly on the DOM
 * node so 60/120Hz drags stay smooth without per-frame component re-renders.
 */
export function createSheetDragController(
  options: SheetDragOptions,
): SheetDragController {
  let pointerId: number | null = null
  let dragAbort: AbortController | null = null
  let startY = 0
  let startHeight = 0
  let startSnap: SheetSnap = 'half'
  let lastY = 0
  let lastTime = 0
  let velocity = 0
  let moved = false
  let suppressNextClick = false

  function isMobileViewport(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(MOBILE_SHEET_QUERY).matches
    )
  }

  function applyLiveHeight(panel: HTMLElement, heightPx: number): void {
    let viewport = window.innerHeight
    panel.style.height = `${heightPx}px`
    panel.dataset.dragging = 'true'
    panel.dataset.elevated = heightPx > viewport * 0.72 ? 'true' : 'false'
    panel.dataset.edgeTop = heightPx >= viewport - 20 ? 'true' : 'false'
  }

  function resetInlineState(): void {
    dragAbort?.abort()
    dragAbort = null
    pointerId = null
    let panel = options.getPanel()
    if (!panel) return
    panel.style.height = ''
    delete panel.dataset.dragging
    delete panel.dataset.edgeTop
  }

  function stopTracking(): void {
    dragAbort?.abort()
    dragAbort = null
    pointerId = null
  }

  options.signal?.addEventListener('abort', stopTracking, { once: true })

  function onPointerMove(event: PointerEvent): void {
    if (pointerId !== event.pointerId) return
    let panel = options.getPanel()
    if (!panel) return

    let dy = event.clientY - startY
    if (!moved) {
      if (Math.abs(dy) < DRAG_THRESHOLD_PX) return
      moved = true
    }

    let dt = Math.max(1, event.timeStamp - lastTime)
    let instantVelocity = (event.clientY - lastY) / dt
    velocity = velocity * 0.4 + instantVelocity * 0.6
    lastY = event.clientY
    lastTime = event.timeStamp

    let nextHeight = clampSheetHeight(startHeight - dy, window.innerHeight)
    applyLiveHeight(panel, nextHeight)
  }

  function finish(event: PointerEvent, cancelled: boolean): void {
    if (pointerId !== event.pointerId) return
    let wasMoved = moved
    let dy = event.clientY - startY
    stopTracking()

    let panel = options.getPanel()
    if (!wasMoved) return

    suppressNextClick = true
    queueMicrotask(() => {
      suppressNextClick = false
    })

    if (!panel) return
    let finalHeight = clampSheetHeight(startHeight - dy, window.innerHeight)

    if (cancelled) {
      delete panel.dataset.dragging
      delete panel.dataset.edgeTop
      void panel.offsetHeight
      panel.style.height = ''
      return
    }

    let outcome = resolveSheetDrop(
      finalHeight,
      window.innerHeight,
      velocity,
      startSnap,
    )
    if (outcome === 'dismiss') {
      // Keep the released height while the exit animation slides the sheet out.
      delete panel.dataset.dragging
      delete panel.dataset.edgeTop
      panel.style.height = `${finalHeight}px`
      options.onDismiss()
      return
    }

    // Re-enable CSS transitions before clearing inline height so the sheet
    // glides smoothly from the exact drop point to its snap height.
    delete panel.dataset.dragging
    delete panel.dataset.edgeTop
    void panel.offsetHeight
    panel.dataset.snap = outcome
    panel.dataset.elevated = outcome === 'full' ? 'true' : 'false'
    panel.style.height = ''
    options.onSnap(outcome)
  }

  function onPointerDown(event: PointerEvent, fromHandle: boolean): void {
    if (!isMobileViewport()) return
    if (!event.isPrimary) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (!fromHandle && isInteractiveTarget(event.target)) return

    let panel = options.getPanel()
    if (!panel) return

    stopTracking()
    pointerId = event.pointerId
    startY = event.clientY
    startHeight = panel.getBoundingClientRect().height
    let rawSnap = panel.dataset.snap
    startSnap =
      rawSnap === 'peek' || rawSnap === 'full' || rawSnap === 'half'
        ? rawSnap
        : 'half'
    lastY = event.clientY
    lastTime = event.timeStamp
    velocity = 0
    moved = false

    dragAbort = new AbortController()
    let { signal } = dragAbort
    window.addEventListener('pointermove', onPointerMove, { signal })
    window.addEventListener('pointerup', (up) => finish(up, false), { signal })
    window.addEventListener('pointercancel', (cancel) => finish(cancel, true), {
      signal,
    })
  }

  return {
    onPointerDown,
    consumeSuppressedClick: () => {
      if (!suppressNextClick) return false
      suppressNextClick = false
      return true
    },
    resetInlineState,
  }
}
