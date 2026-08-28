import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PowerPagination } from './PowerPagination'

afterEach(cleanup)

describe('PowerPagination', () => {
  it('disables boundary arrows and moves one page at a time', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    const { rerender } = render(
      <PowerPagination page={1} totalPages={4} canGoNext onPageChange={onPageChange} />
    )

    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(2)

    rerender(
      <PowerPagination page={4} totalPages={4} canGoNext={false} onPageChange={onPageChange} />
    )
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('commits a page number on Enter', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<PowerPagination page={1} totalPages={4} canGoNext onPageChange={onPageChange} />)

    const input = screen.getByRole('spinbutton', { name: 'Page number' })
    await user.clear(input)
    await user.type(input, '3{Enter}')
    expect(onPageChange).toHaveBeenCalledOnce()
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('clamps on blur and restores invalid input', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<PowerPagination page={2} totalPages={4} canGoNext onPageChange={onPageChange} />)
    const input = screen.getByRole('spinbutton', { name: 'Page number' })

    await user.clear(input)
    await user.type(input, '9')
    await user.tab()
    expect(onPageChange).toHaveBeenLastCalledWith(4)

    await user.clear(input)
    await user.type(input, 'abc')
    await user.tab()
    expect((input as HTMLInputElement).value).toBe('2')
    expect(onPageChange).toHaveBeenCalledTimes(1)
  })
})
