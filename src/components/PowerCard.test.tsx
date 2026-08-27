import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PowerSeries } from '../api/contracts'
import { PowerCard } from './PowerCard'

afterEach(cleanup)

const series: PowerSeries = {
  type: 'skill',
  name: 'code-review',
  versions: [
    {
      version: 'v2.0.0',
      description: 'Peer review with a quality gate.',
      tags: ['code-review', 'quality'],
    },
    {
      version: 'v1.0.0',
      description: 'Peer review workflow.',
      tags: ['writing'],
    },
  ],
}

describe('PowerCard', () => {
  it('renders the series type and name', () => {
    render(<PowerCard series={series} />)

    expect(screen.getByText('skill')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'code-review' })).toBeTruthy()
  })

  it('defaults the version select and both textareas to the first version', () => {
    render(<PowerCard series={series} />)

    expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('v2.0.0')
    expect(screen.getByDisplayValue('Peer review with a quality gate.')).toBeTruthy()
    expect(screen.getByDisplayValue('code-review quality')).toBeTruthy()
  })

  it('updates the description and tags together when the version changes', async () => {
    const user = userEvent.setup()
    render(<PowerCard series={series} />)

    await user.selectOptions(screen.getByLabelText('Version'), 'v1.0.0')

    expect(screen.getByDisplayValue('Peer review workflow.')).toBeTruthy()
    expect(screen.getByDisplayValue('writing')).toBeTruthy()
    expect(screen.queryByDisplayValue('Peer review with a quality gate.')).toBeNull()
  })

  it('resets the selected version when the series changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PowerCard series={series} />)

    await user.selectOptions(screen.getByLabelText('Version'), 'v1.0.0')
    expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('v1.0.0')

    const other: PowerSeries = {
      type: 'plugin',
      name: 'scan-guard',
      versions: [
        { version: 'v3.0.0', description: 'Guards dependency scans.', tags: ['security'] },
        { version: 'v1.2.0', description: 'Older scan guard.', tags: [] },
      ],
    }
    rerender(<PowerCard series={other} />)

    expect((screen.getByLabelText('Version') as HTMLSelectElement).value).toBe('v3.0.0')
    expect(screen.getByDisplayValue('Guards dependency scans.')).toBeTruthy()
  })
})
