import { useRef } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useFittedFontSize } from './useFittedFontSize'

afterEach(cleanup)

/**
 * jsdom's Range has no getBoundingClientRect (every real engine does), so the width of the
 * measured text comes from here instead.
 */
let naturalWidth = 0
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: naturalWidth }) as DOMRect,
  })
})

const Harness = ({ name }: { name: string }) => {
  const ref = useRef<HTMLHeadingElement>(null)
  useFittedFontSize(ref, name, { max: 19, min: 13 })
  return <h2 ref={ref}>{name}</h2>
}

/**
 * jsdom has no layout, so the box width and the natural text width are declared by hand and
 * the fit is triggered the way a real card triggers it: by a resize of the box.
 */
const fittedSize = (name: string, width: number, natural: number) => {
  naturalWidth = natural
  render(<Harness name={name} />)
  const title = screen.getByRole('heading', { name })
  Object.defineProperty(title, 'clientWidth', { configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
  return title.style.fontSize
}

describe('useFittedFontSize', () => {
  it('keeps the cap size when the name already fits', () => {
    expect(fittedSize('vibe-coder', 225, 210)).toBe('19px')
  })

  it('shrinks proportionally so the name fills the box', () => {
    // 19px * (225 / 300) = 14.25px, rounded down to a half pixel.
    expect(fittedSize('markdown-maker-plus', 225, 300)).toBe('14px')
  })

  it('never shrinks below the floor', () => {
    // 19px * (225 / 450) = 9.5px would be unreadable; the ellipsis covers the rest.
    expect(fittedSize('a-very-long-power-name', 225, 450)).toBe('13px')
  })

  it('leaves the stylesheet size alone before the box has a width', () => {
    expect(fittedSize('code-review', 0, 0)).toBe('')
  })
})
