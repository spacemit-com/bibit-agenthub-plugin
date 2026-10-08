import { useRef } from 'react'
import { ScrollThumb } from '../ScrollThumb'
import { useFittedFontSize } from '../useFittedFontSize'
import { useAgentHubI18n, useAgentHubLanguage, type TranslatableText } from '../agentHubI18n'
import { resolvePowerDescription, resolvePowerTitle, resolvePowerTypeLabel } from '../displayFields'
import type { PowerSeries } from '../api/contracts'

export interface PowerCardProps {
  series: PowerSeries
  selectedVersion: string
  onVersionChange(version: string): void
  onDetails?: () => void
  busy: boolean
  notice?: TranslatableText
  /**
   * Set by the market scope when the chosen Agent's install manifest already has
   * this Power. Version-agnostic on purpose: the card's version select is the
   * *install target*, so a Power that is installed at another version still reads
   * as installed, and the dialog is where the exact version is shown.
   */
  installed?: boolean
}

export function PowerCard({
  series,
  selectedVersion,
  onVersionChange,
  onDetails,
  busy,
  notice,
  installed,
}: PowerCardProps) {
  const t = useAgentHubI18n()
  const language = useAgentHubLanguage()
  const descriptionRef = useRef<HTMLParagraphElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const current = series.versions.find((version) => version.version === selectedVersion) ?? series.versions[0]
  // The title is the series' display name (canonical name for V1 resources), so it
  // does not change with the version select; the description below is per version.
  const title = resolvePowerTitle(series, language)
  const description = resolvePowerDescription(current, language)
  // A hand-installed resource is a single directory with no version to choose
  // from, so its version slot is a static label (and "No version" when the
  // resource declares none) instead of a control with one entry.
  const custom = series.source === 'custom'
  // The name stays on one line at whatever size fits, so the card rows line up.
  useFittedFontSize(titleRef, title, { max: 19, min: 13 })

  const openDetails = () => {
    if (!busy && onDetails) onDetails()
  }

  return (
    <article
      className="power-card"
      data-power-type={series.type}
      data-source={custom ? 'custom' : undefined}
      data-clickable={onDetails ? 'true' : undefined}
      onClick={openDetails}
    >
      <div className="power-card__header">
        <span className="power-card__type">{resolvePowerTypeLabel(series.type)}</span>
        {custom && <span className="power-card__badge">{t('Custom')}</span>}
        {/* The two badges never co-exist: a custom resource only ever comes from the
            local scan on the installed tab, while `installed` is only set for market
            cards. */}
        {installed && <span className="power-card__badge power-card__badge--installed">{t('Installed')}</span>}
        {custom ? (
          <span className="power-card__version power-card__version--static" data-testid="power-card-version">
            {current.version || t('No version')}
          </span>
        ) : (
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
        )}
      </div>
      <h2 ref={titleRef}>{title}</h2>
      <p className="power-card__description" ref={descriptionRef}>
        {description}
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
