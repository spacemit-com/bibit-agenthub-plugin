import { useCallback, useLayoutEffect, type RefObject } from 'react'

export interface FittedFontSizeOptions {
  /** Font size used when the text already fits — the cap. */
  max: number
  /** Smallest size we are willing to shrink to; below that the text is ellipsised. */
  min: number
}

/**
 * Shrink a single-line title until it fits its box, so a long Power name cannot wrap onto a
 * second line and every card keeps the same title height.
 *
 * A line of text is proportional to its font size, so one measurement at a known size is
 * enough to solve for the size that fills the box: measure the natural width of the text at
 * `max`, then scale it by `available / natural`. The element receives an inline font-size;
 * the caller keeps the box itself at a fixed height (`.power-card h2` in agentHub.css).
 */
export function useFittedFontSize(
  ref: RefObject<HTMLElement | null>,
  text: string,
  { max, min }: FittedFontSizeOptions
) {
  const fit = useCallback(() => {
    const node = ref.current
    if (!node) return
    const available = node.clientWidth
    // jsdom and a not-yet-laid-out node both report 0; leave the CSS size in place then.
    if (available <= 0) return
    node.style.fontSize = `${max}px`
    // The range reports the width of the text itself, even when the box clips it.
    const range = document.createRange()
    range.selectNodeContents(node)
    const natural = range.getBoundingClientRect().width
    if (natural <= 0) return
    const fitted = Math.max(min, Math.min(max, (max * available) / natural))
    node.style.fontSize = `${Math.floor(fitted * 2) / 2}px`
  }, [max, min, ref])

  // Re-fit when the text changes…
  useLayoutEffect(() => {
    fit()
  }, [fit, text])

  // …and when the card changes size (window resize, sidebar collapse, another column count).
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    window.addEventListener('resize', fit)
    if (typeof ResizeObserver !== 'function') {
      return () => window.removeEventListener('resize', fit)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(node)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [fit, ref])
}
