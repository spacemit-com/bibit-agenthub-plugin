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
    <article>
      <span>{series.type}</span>
      <h2>{series.name}</h2>
      <label>
        Version
        <select
          value={selectedVersion}
          onChange={(event) => setSelectedVersion(event.target.value)}
        >
          {series.versions.map((version) => (
            <option key={version.version} value={version.version}>
              {version.version}
            </option>
          ))}
        </select>
      </label>
      <textarea readOnly value={current.description} />
      <textarea readOnly rows={1} wrap="off" value={current.tags.join(' ')} />
    </article>
  )
}
