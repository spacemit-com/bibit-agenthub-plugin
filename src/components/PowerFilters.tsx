import { POWER_TYPES, type PowerScope, type PowerType } from '../api/contracts'

export interface PowerFiltersProps {
  scope: PowerScope
  agents: readonly string[]
  agent: string
  type: PowerType
  availableTags: readonly string[]
  selectedTags: readonly string[]
  onScopeChange(scope: PowerScope): void
  onAgentChange(agent: string): void
  onTypeChange(type: PowerType): void
  onTagsChange(tags: string[]): void
}

const SCOPES: readonly PowerScope[] = ['installed', 'market']
const SCOPE_LABELS: Record<PowerScope, string> = {
  installed: '我的 Power',
  market: 'Power 市场',
}

export function PowerFilters({
  scope,
  agents,
  agent,
  type,
  availableTags,
  selectedTags,
  onScopeChange,
  onAgentChange,
  onTypeChange,
  onTagsChange,
}: PowerFiltersProps) {
  return (
    <div>
      <div role="group" aria-label="Scope">
        {SCOPES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === scope}
            disabled={value === scope}
            onClick={() => onScopeChange(value)}
          >
            {SCOPE_LABELS[value]}
          </button>
        ))}
      </div>
      {scope === 'installed' && (
        <div role="group" aria-label="Agent">
          {agents.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === agent}
              disabled={value === agent}
              onClick={() => onAgentChange(value)}
            >
              {value}
            </button>
          ))}
        </div>
      )}
      <div role="group" aria-label="Type">
        {POWER_TYPES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === type}
            disabled={value === type}
            onClick={() => onTypeChange(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <label>
        Tags
        <select
          multiple
          value={[...selectedTags]}
          onChange={(event) =>
            onTagsChange(
              Array.from(event.target.selectedOptions)
                .map((option) => option.value)
                .sort()
            )
          }
        >
          {availableTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
