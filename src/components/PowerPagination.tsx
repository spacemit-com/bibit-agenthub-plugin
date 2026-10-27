import { useEffect, useState } from 'react'
import { useAgentHubI18n } from '../agentHubI18n'

export interface PowerPaginationProps {
  page: number
  totalPages: number
  canGoNext: boolean
  onPageChange(page: number): void
}

export function PowerPagination({
  page,
  totalPages,
  canGoNext,
  onPageChange,
}: PowerPaginationProps) {
  const [draft, setDraft] = useState(String(page))
  const t = useAgentHubI18n()

  useEffect(() => setDraft(String(page)), [page])

  if (totalPages <= 1) return null

  const commitDraft = () => {
    const trimmed = draft.trim()
    if (!/^\d+$/.test(trimmed)) {
      setDraft(String(page))
      return
    }
    const next = Math.min(totalPages, Math.max(1, Number(trimmed)))
    setDraft(String(next))
    if (next !== page) onPageChange(next)
  }

  return (
    <nav className="power-pagination" aria-label={t('Power pages')}>
      <button
        type="button"
        aria-label={t('Previous page')}
        disabled={page === 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <span>{t('Page')}</span>
      <input
        aria-label={t('Page number')}
        type="number"
        min={1}
        max={totalPages}
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitDraft()
        }}
      />
      <span>{t('of {total}', { total: totalPages })}</span>
      <button
        type="button"
        aria-label={t('Next page')}
        disabled={!canGoNext || page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        <span aria-hidden="true">›</span>
      </button>
    </nav>
  )
}
