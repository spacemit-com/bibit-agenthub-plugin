import { useRef } from 'react'
import { ScrollThumb } from '../ScrollThumb'
import { useFittedFontSize } from '../useFittedFontSize'
import { useAgentHubI18n, useAgentHubLanguage, type TranslatableText } from '../agentHubI18n'
import { resolvePowerDescription, resolvePowerTitle, resolvePowerTypeLabel } from '../displayFields'
import type { PowerSeries } from '../api/contracts'

export interface PowerCardProps {
  series: PowerSeries
  onDetails?: () => void
  busy: boolean
  notice?: TranslatableText
  /**
   * Set by the market scope when the chosen Agent's install manifest already has
   * this Power. Version-agnostic: the card shows the newest version the catalog
   * lists, so a Power installed at an older version still reads as installed.
   */
  installed?: boolean
  /**
   * The catalog lists something newer than the installed version. Only meaningful
   * next to the installed badge, which is why the badge is gated on `installed`.
   */
  hasNewer?: boolean
}

export function PowerCard({
  series,
  onDetails,
  busy,
  notice,
  installed,
  hasNewer,
}: PowerCardProps) {
  const t = useAgentHubI18n()
  const language = useAgentHubLanguage()
  const descriptionRef = useRef<HTMLParagraphElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  // The card is display-only. It always shows the newest version the series has, and
  // choosing one happens in the details dialog.
  const current = series.versions[0]
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
        {/* The custom and installed badges never co-exist: a custom resource only ever
            comes from the local scan on the installed tab, while `installed` is only
            set for market cards. The version slot is a label on every card now, in
            DOM order after the badges so `New` sits left of `Installed`. */}
        {custom && <span className="power-card__badge">{t('Custom')}</span>}
        {installed && hasNewer && (
          <span className="power-card__badge power-card__badge--new">{t('New')}</span>
        )}
        {installed && <span className="power-card__badge power-card__badge--installed">{t('Installed')}</span>}
        <span className="power-card__version" data-testid="power-card-version">
          {current.version || t('No version')}
        </span>
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
