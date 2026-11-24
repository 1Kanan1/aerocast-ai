export type SheetSnap = 'peek' | 'half' | 'full'
export type SheetDropOutcome = SheetSnap | 'dismiss'

export const MOBILE_SHEET_QUERY = '(max-width: 900px)'
export const SHEET_PEEK_PX = 184
export const SHEET_DISMISS_PX = 112

const DRAG_THRESHOLD_PX = 6
const FLICK_VELOCITY_PX_PER_MS = 0.45

/** Clamps a live mobile sheet height to the visible viewport. */
export function clampSheetHeight(
  heightPx: number,
  viewportHeight: number,
): number {
  let max = Math.max(0, viewportHeight)
  return Math.max(0, Math.min(max, Math.round(heightPx)))
}

/**
 * Resolves a released mobile bottom sheet into a snap target or dismiss action.
 * Positive velocity means downward motion (shrinking); negative means upward.
 */
export function resolveSheetDrop(
  heightPx: number,
  viewportHeight: number,
  velocityPxPerMs: number,
): SheetDropOutcome {
  if (heightPx <= SHEET_DISMISS_PX) return 'dismiss'

  let ratio = viewportHeight > 0 ? heightPx / viewportHeight : 0.5

  if (velocityPxPerMs > FLICK_VELOCITY_PX_PER_MS) {
    if (ratio < 0.42) return 'dismiss'
    if (ratio < 0.78) return 'peek'
    return 'half'
  }

  if (velocityPxPerMs < -FLICK_VELOCITY_PX_PER_MS) {
    return ratio >= 0.42 ? 'full' : 'half'
  }

  if (ratio >= 0.78) return 'full'
  if (ratio <= 0.34) return 'peek'
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

    let outcome = resolveSheetDrop(finalHeight, window.innerHeight, velocity)
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
