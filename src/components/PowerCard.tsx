import { useEffect, useState } from 'react'
import type { PowerSeries } from '../api/contracts'

export interface PowerCardProps {
  series: PowerSeries
}

export function PowerCard({ series }: PowerCardProps) {
  const [selectedVersion, setSelectedVersion] = useState(series.versions[0].version)

  useEffect(() => {
    setSelectedVersion(series.versions[0].version)
  }, [series.type, series.name, series.versions])

  const current = series.versions.find((version) => version.version === selectedVersion) ?? series.versions[0]

  return (
    <article className="power-card" data-power-type={series.type}>
      <div className="power-card__header">
        <span className="power-card__type">{series.type}</span>
        <select
          className="power-card__version"
          aria-label="Version"
          value={selectedVersion}
          onChange={(event) => setSelectedVersion(event.target.value)}
        >
          {series.versions.map((version) => (
            <option key={version.version} value={version.version}>
              {version.version}
            </option>
          ))}
        </select>
      </div>
      <h2>{series.name}</h2>
      <p className="power-card__description">{current.description}</p>
      <div className="power-card__tags" data-testid="power-card-tags">
        {current.tags.map((tag) => (
          <span key={tag} className="power-card__tag">
            {tag}
          </span>
        ))}
      </div>
    </article>
  )
}
