import { useRef } from 'react'
import { ScrollThumb } from '../ScrollThumb'
import { useFittedFontSize } from '../useFittedFontSize'
import { useAgentHubI18n, useAgentHubLanguage, type TranslatableText } from '../agentHubI18n'
import { resolvePowerDescription, resolvePowerTitle } from '../displayFields'
import type { PowerSeries } from '../api/contracts'

export interface PowerCardProps {
  series: PowerSeries
  onDetails?: () => void
  onInstall?: () => void
  installDisabled?: boolean
  busy: boolean
  notice?: TranslatableText
  /**
   * Set for installed-list entries and market entries already present for the
   * chosen Agent. Version-agnostic: an older installed version still counts.
   */
  installed?: boolean
  /**
   * The catalog lists something newer than the installed version. Only meaningful
   * for an installed Power, which is why the badge is gated on `installed`.
   */
  hasNewer?: boolean
}

export function PowerCard({
  series,
  onDetails,
  onInstall,
  installDisabled = false,
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
  // Card descriptions and tags use the newest version. Version information and
  // selection live in the details dialog.
  const current = series.versions[0]
  // The title is the series' display name (canonical name for V1 resources), so it
  // does not change with the version select; the description below is per version.
  const title = resolvePowerTitle(series, language)
  const description = resolvePowerDescription(current, language)
  // A hand-installed directory uses the custom-resource actions in its details,
  // never the catalog's installation action.
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
        {/* The type name is now the displayed word too: the CSS capitalises it. */}
        <span className="power-card__type">{series.type}</span>
        {custom && <span className="power-card__badge">{t('Custom')}</span>}
        {installed && hasNewer && (
          <span className="power-card__badge power-card__badge--new">{t('New')}</span>
        )}
      </div>
      <h2 ref={titleRef}>
        {/* The whole card opens the details with a mouse, but a pointer-only target has
            no keyboard equivalent. A button *inside* the heading is the standard
            clickable-card pattern: the heading keeps its semantics and therefore its
            accessible name, the control lands in the tab order, and -- unlike an
            overlay button stretched across the card -- the description's own scroller
            stays reachable. When the card has no details target it is plain text
            again. */}
        {onDetails ? (
          <button
            type="button"
            className="power-card__open"
            disabled={busy}
            onClick={(event) => {
              // The article's own onClick would otherwise fire too, opening the dialog
              // twice for a single press.
              event.stopPropagation()
              openDetails()
            }}
          >
            {title}
          </button>
        ) : (
          title
        )}
      </h2>
      <p className="power-card__description" ref={descriptionRef}>
        {description}
        <ScrollThumb targetRef={descriptionRef} />
      </p>
      <div className="power-card__footer">
        <div className="power-card__tags" data-testid="power-card-tags" ref={tagsRef}>
          {installed && (
            <span className="power-card__tag power-card__badge--installed">{t('Installed')}</span>
          )}
          {current.tags.map((tag) => (
            <span key={tag} className="power-card__tag">
              {tag}
            </span>
          ))}
          <ScrollThumb targetRef={tagsRef} axis="x" />
        </div>
        {!installed && !custom && onInstall && (
          <button
            type="button"
            className="power-card__install"
            disabled={busy || installDisabled}
            onClick={(event) => {
              event.stopPropagation()
              if (!busy && !installDisabled) onInstall()
            }}
          >
            {t('Add capability')}
          </button>
        )}
      </div>
      {notice && (
        <p className="power-card__notice" role="status">
          {t(notice.text, notice.values)}
        </p>
      )}
    </article>
  )
}
