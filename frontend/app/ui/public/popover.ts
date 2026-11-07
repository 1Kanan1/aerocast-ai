const CLOSE_MS = 160

/**
 * Native popovers hide immediately on Escape and light dismiss, before an
 * exit animation can run. The drawer and search are `manual` popovers, so
 * closing is ours: mark the exit animation, then hide when it finishes.
 */
export function closePopover(
  popover: HTMLElement,
  durationMs = CLOSE_MS,
): void {
  if (!popover.matches(':popover-open')) return
  if (popover.dataset.closing === 'true') return

  popover.dataset.closing = 'true'
  setTimeout(() => {
    popover.hidePopover()
    delete popover.dataset.closing
  }, durationMs)
}

/**
 * Escape and a click outside close the panel. The trigger that opens it is
 * left alone while closed, and turns into an animated close while open.
 */
export function onPopoverDismiss(
  popover: HTMLElement,
  close: () => void,
  signal: AbortSignal,
): void {
  let isOpen = () => popover.matches(':popover-open')

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !isOpen()) return
      event.preventDefault()
      close()
    },
    { signal },
  )

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!isOpen()) return
      let target = event.target
      if (!(target instanceof Element)) return
      if (popover.contains(target)) return

      // This panel's own trigger is handled on click, so it can animate the
      // close instead of letting the platform toggle it shut instantly.
      if (triggerFor(target, popover) !== null) return
      close()
    },
    { signal },
  )

  document.addEventListener(
    'click',
    (event) => {
      let target = event.target
      if (!(target instanceof Element)) return
      if (!isOpen()) return
      if (triggerFor(target, popover) === null) return

      // An open panel's own trigger would toggle it shut instantly.
      event.preventDefault()
      close()
    },
    { capture: true, signal },
  )
}

function triggerFor(target: Element, popover: HTMLElement): Element | null {
  let trigger = target.closest('[popovertarget]')
  if (trigger === null || popover.id === '') return null
  return trigger.getAttribute('popovertarget') === popover.id ? trigger : null
}
