import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** How long the thumb stays on screen after the last scroll event. */
const HIDE_DELAY_MS = 1000
/** Thickness of the drawn bar, matching the host's 8px scrollbar. */
const THICKNESS_PX = 8
/** Never let the thumb shrink below something a user can aim at. */
const MIN_LENGTH_PX = 24

export interface ScrollThumbProps {
  /** Scroll container the thumb belongs to. The thumb renders inside it. */
  targetRef: RefObject<HTMLElement | null>
  axis?: 'x' | 'y'
}

interface ThumbGeometry {
  /** Position along the axis, relative to the visible area of the scroller. */
  offset: number
  size: number
}

/**
 * Overlay scrollbar thumb: hidden while its scroller is idle, visible while it moves.
 *
 * The platform scrollbar cannot be styled from a plugin page. Bibit's global stylesheet
 * sets `scrollbar-width: thin` on every element, and a non-`auto` `scrollbar-width` makes
 * WebKit ignore all `::-webkit-scrollbar` rules; `scrollbar-color` is not supported by
 * WebKitGTK at all; and WebKitGTK keeps the bar it created when a scrollbar style changes
 * at runtime, so a bar can neither be hidden at rest nor revealed on demand (all verified
 * against WebKitGTK 2.52 on the dev board — see docs section 7.2).
 *
 * So the plugin hides the native bar (`scrollbar-width: none`, which it *can* set) and
 * draws the indicator itself: proportional length and position, revealed on scroll and
 * faded out a second after the last scroll event.
 */
export function ScrollThumb({ targetRef, axis = 'y' }: ScrollThumbProps) {
  const [geometry, setGeometry] = useState<ThumbGeometry | null>(null)
  const [visible, setVisible] = useState(false)
  const hideTimerRef = useRef<number | undefined>(undefined)

  const measure = useCallback(() => {
    const node = targetRef.current
    if (!node) return
    const vertical = axis === 'y'
    const client = vertical ? node.clientHeight : node.clientWidth
    const total = vertical ? node.scrollHeight : node.scrollWidth
    const scroll = vertical ? node.scrollTop : node.scrollLeft
    if (client <= 0 || total - client < 1) {
      setGeometry(null)
      return
    }
    const size = Math.min(client, Math.max(MIN_LENGTH_PX, Math.round((client * client) / total)))
    const travel = client - size
    const progress = Math.min(1, Math.max(0, scroll / (total - client)))
    const next = { offset: Math.round(progress * travel), size }
    setGeometry((current) =>
      current && current.offset === next.offset && current.size === next.size ? current : next
    )
  }, [axis, targetRef])

  // Measure after every render: the content (and so the thumb ratio) changes with the data.
  useLayoutEffect(measure)

  useEffect(() => {
    const node = targetRef.current
    if (!node) return
    const reveal = () => {
      measure()
      setVisible(true)
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = window.setTimeout(() => setVisible(false), HIDE_DELAY_MS)
    }
    node.addEventListener('scroll', reveal, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      node.removeEventListener('scroll', reveal)
      window.removeEventListener('resize', measure)
      window.clearTimeout(hideTimerRef.current)
    }
  }, [measure, targetRef])

  if (!geometry) return null
  const node = targetRef.current
  // An absolutely positioned child of a scroller moves with its content, so the offset is
  // expressed in content coordinates to keep the bar still relative to the visible area.
  const style =
    axis === 'y'
      ? { top: (node?.scrollTop ?? 0) + geometry.offset, height: geometry.size, width: THICKNESS_PX }
      : { left: (node?.scrollLeft ?? 0) + geometry.offset, width: geometry.size, height: THICKNESS_PX }

  return (
    <span
      className="agent-hub__scroll-thumb"
      data-axis={axis}
      data-visible={visible ? 'true' : 'false'}
      style={style}
      aria-hidden="true"
    />
  )
}
