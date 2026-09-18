import { useRef } from 'react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ScrollThumb } from './ScrollThumb'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
})

/** jsdom has no layout, so the scroll metrics are declared by hand. */
const withMetrics = (
  element: HTMLElement,
  metrics: { clientHeight?: number; scrollHeight?: number; clientWidth?: number; scrollWidth?: number }
) => {
  for (const [property, value] of Object.entries(metrics)) {
    Object.defineProperty(element, property, { configurable: true, value })
  }
}

const VerticalHarness = () => {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} data-testid="scroller">
      <ScrollThumb targetRef={ref} />
    </div>
  )
}

const HorizontalHarness = () => {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} data-testid="scroller">
      <ScrollThumb targetRef={ref} axis="x" />
    </div>
  )
}

const thumb = () => document.querySelector('.agent-hub__scroll-thumb') as HTMLElement | null

describe('ScrollThumb', () => {
  it('draws nothing while the scroller has no overflow', () => {
    render(<VerticalHarness />)
    const scroller = screen.getByTestId('scroller')
    withMetrics(scroller, { clientHeight: 110, scrollHeight: 110 })
    fireEvent(window, new Event('resize'))

    expect(thumb()).toBeNull()
  })

  it('sizes and places itself proportionally, and stays hidden while idle', () => {
    render(<VerticalHarness />)
    const scroller = screen.getByTestId('scroller')
    withMetrics(scroller, { clientHeight: 110, scrollHeight: 440 })
    fireEvent(window, new Event('resize'))

    // 110/440 of the visible area = a 28px thumb, at the top of the track.
    expect(thumb()?.style.height).toBe('28px')
    expect(thumb()?.style.top).toBe('0px')
    expect(thumb()?.dataset.visible).toBe('false')
    expect(thumb()?.dataset.axis).toBe('y')

    scroller.scrollTop = 165 // half of the 330px of travel
    fireEvent.scroll(scroller)

    expect(thumb()?.dataset.visible).toBe('true')
    expect(thumb()?.style.top).toBe(`${165 + 41}px`)

    act(() => { vi.advanceTimersByTime(1500) })
    expect(thumb()?.dataset.visible).toBe('false')
  })

  it('stays visible while the scroller keeps moving', () => {
    render(<VerticalHarness />)
    const scroller = screen.getByTestId('scroller')
    withMetrics(scroller, { clientHeight: 100, scrollHeight: 400 })
    fireEvent(window, new Event('resize'))

    scroller.scrollTop = 50
    fireEvent.scroll(scroller)
    act(() => { vi.advanceTimersByTime(600) })
    scroller.scrollTop = 100
    fireEvent.scroll(scroller)
    act(() => { vi.advanceTimersByTime(600) })

    expect(thumb()?.dataset.visible).toBe('true')

    act(() => { vi.advanceTimersByTime(1500) })
    expect(thumb()?.dataset.visible).toBe('false')
  })

  it('handles a horizontal scroller', () => {
    render(<HorizontalHarness />)
    const scroller = screen.getByTestId('scroller')
    withMetrics(scroller, { clientWidth: 100, scrollWidth: 400 })
    fireEvent(window, new Event('resize'))

    scroller.scrollLeft = 100
    fireEvent.scroll(scroller)

    // 100/400 of the visible area = 25px wide, a third of the way along the 75px of travel.
    expect(thumb()?.style.width).toBe('25px')
    expect(thumb()?.style.height).toBe('8px')
    expect(thumb()?.style.left).toBe(`${100 + 25}px`)
    expect(thumb()?.dataset.axis).toBe('x')
  })

  it('drops the thumb again when the content stops overflowing', () => {
    render(<VerticalHarness />)
    const scroller = screen.getByTestId('scroller')
    withMetrics(scroller, { clientHeight: 110, scrollHeight: 440 })
    fireEvent.scroll(scroller)
    expect(thumb()).not.toBeNull()

    withMetrics(scroller, { clientHeight: 110, scrollHeight: 110 })
    fireEvent(window, new Event('resize'))

    expect(thumb()).toBeNull()
  })
})
