import { useRef } from 'react'
import { ScrollThumb } from '../ScrollThumb'
import { useAgentHubI18n, type TranslatableText } from '../agentHubI18n'
import type { PowerSeries } from '../api/contracts'

export interface PowerCardProps {
  series: PowerSeries
  selectedVersion: string
  onVersionChange(version: string): void
  onDetails?: () => void
  busy: boolean
  notice?: TranslatableText
}

export function PowerCard({
  series,
  selectedVersion,
  onVersionChange,
  onDetails,
  busy,
  notice,
}: PowerCardProps) {
  const t = useAgentHubI18n()
  const descriptionRef = useRef<HTMLParagraphElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const current = series.versions.find((version) => version.version === selectedVersion) ?? series.versions[0]

  const openDetails = () => {
    if (!busy && onDetails) onDetails()
  }

  return (
    <article
      className="power-card"
      data-power-type={series.type}
      data-clickable={onDetails ? 'true' : undefined}
      onClick={openDetails}
    >
      <div className="power-card__header">
        <span className="power-card__type">{series.type}</span>
        <select
          className="power-card__version"
          aria-label={t('Version')}
          value={current.version}
          disabled={busy}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onVersionChange(event.target.value)}
        >
          {series.versions.map((version) => (
            <option key={version.version} value={version.version}>
              {version.version}
            </option>
          ))}
        </select>
      </div>
      <h2>{series.name}</h2>
      <p className="power-card__description" ref={descriptionRef}>
        {current.description}
        <ScrollThumb targetRef={descriptionRef} />
      </p>
      <div className="power-card__tags" data-testid="power-card-tags" ref={tagsRef}>
        {current.tags.map((tag) => (
          <span key={tag} className="power-card__tag">
            {tag}
          </span>
        ))}
        <ScrollThumb targetRef={tagsRef} axis="x" />
      </div>
      {notice && (
        <p className="power-card__notice" role="status">
          {t(notice.text, notice.values)}
        </p>
      )}
    </article>
  )
}
