import {
  POWER_PAGE_SIZE,
  parseListPowersInput,
  type ListPowersResult,
  type PowerSeries,
  type PowerType,
  type PowerWarning,
} from '../src/api/contracts'

const SNAPSHOT = 'local-preview-v1'

const PARTIALLY_UNAVAILABLE_AGENTS = new Set(['nova'])
const PARTIAL_AGENT_WARNING_MESSAGE = 'Some installed Powers for this agent are temporarily unavailable.'

type MockPowerRecord = {
  scope: 'installed' | 'market'
  agent?: string
  type: PowerType
  name: string
  version: string
  description: string
  tags: string[]
}

function generatedBibitSkills(): MockPowerRecord[] {
  const records: MockPowerRecord[] = []
  for (let n = 4; n <= 21; n++) {
    const padded = String(n).padStart(2, '0')
    records.push({
      scope: 'installed',
      agent: 'bibit',
      type: 'skill',
      name: `bibit-skill-${padded}`,
      version: 'v1.0.0',
      description: `Bibit utility skill ${padded}.`,
      tags: ['utility'],
    })
  }
  return records
}

const installedFixtures: MockPowerRecord[] = [
  {
    scope: 'installed',
    agent: 'bibit',
    type: 'skill',
    name: 'code-review',
    version: 'v2.0.0',
    description: 'Peer review with a quality gate.',
    tags: ['quality'],
  },
  {
    scope: 'installed',
    agent: 'bibit',
    type: 'skill',
    name: 'code-review',
    version: 'v1.0.0',
    description: 'Peer review workflow.',
    tags: ['code-review'],
  },
  {
    scope: 'installed',
    agent: 'bibit',
    type: 'skill',
    name: 'release-notes',
    version: 'v1.0.0',
    description: 'Turns merged changes into release notes.',
    tags: ['release', 'writing'],
  },
  {
    scope: 'installed',
    agent: 'bibit',
    type: 'skill',
    name: 'incident-helper',
    version: 'v2.0.0',
    description: 'Prepares a safe incident timeline.',
    tags: ['incident', 'safety'],
  },
  {
    scope: 'installed',
    agent: 'bibit',
    type: 'skill',
    name: 'incident-helper',
    version: 'v1.0.0',
    description: 'Collects incident evidence.',
    tags: ['incident'],
  },
  ...generatedBibitSkills(),
  {
    scope: 'installed',
    agent: 'bibit',
    type: 'plugin',
    name: 'scan-guard',
    version: 'v1.2.0',
    description: 'Guards dependency scans.',
    tags: ['security'],
  },
  {
    scope: 'installed',
    agent: 'bibit',
    type: 'mcp',
    name: 'search-mcp',
    version: 'v1.0.0',
    description: 'Searches internal indexes.',
    tags: ['search'],
  },
  {
    scope: 'installed',
    agent: 'bibit',
    type: 'agent',
    name: 'triage-bot',
    version: 'v3.0.0',
    description: 'Triages incoming issues.',
    tags: ['triage'],
  },
  {
    scope: 'installed',
    agent: 'atlas',
    type: 'skill',
    name: 'atlas-lint',
    version: 'v1.1.0',
    description: 'Atlas linter.',
    tags: ['code-review'],
  },
  {
    scope: 'installed',
    agent: 'atlas',
    type: 'plugin',
    name: 'atlas-cache',
    version: 'v2.0.0',
    description: 'Atlas cache plugin.',
    tags: ['perf'],
  },
  {
    scope: 'installed',
    agent: 'nova',
    type: 'skill',
    name: 'nova-summary',
    version: 'v1.0.0',
    description: 'Nova summary skill.',
    tags: ['writing'],
  },
]

const marketFixtures: MockPowerRecord[] = [
  {
    scope: 'market',
    type: 'skill',
    name: 'transcribe',
    version: 'v1.3.0',
    description: 'Transcribes audio.',
    tags: ['transcribe'],
  },
  {
    scope: 'market',
    type: 'skill',
    name: 'translate',
    version: 'v2.0.0',
    description: 'Translates text.',
    tags: ['translate', 'writing'],
  },
  {
    scope: 'market',
    type: 'plugin',
    name: 'cache-warm',
    version: 'v1.0.0',
    description: 'Warms caches.',
    tags: ['perf'],
  },
  {
    scope: 'market',
    type: 'mcp',
    name: 'search-web',
    version: 'v1.0.0',
    description: 'Searches the web.',
    tags: ['search'],
  },
  {
    scope: 'market',
    type: 'agent',
    name: 'market-triage',
    version: 'v1.0.0',
    description: 'Market triage agent.',
    tags: ['triage'],
  },
]

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function parseVersionParts(version: string): [number, number, number] {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`Invalid fixture version: ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersionsDescending(a: string, b: string): number {
  const [amajor, aminor, apatch] = parseVersionParts(a)
  const [bmajor, bminor, bpatch] = parseVersionParts(b)
  if (amajor !== bmajor) return bmajor - amajor
  if (aminor !== bminor) return bminor - aminor
  return bpatch - apatch
}

function compareSeries(a: PowerSeries, b: PowerSeries): number {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return 0
}

export function handlePowerCatalogMock(input: {
  operationId: string
  params: unknown
}): ListPowersResult {
  // 1. validate operationId and params
  if (input.operationId !== 'powers.list.v1') {
    throw new Error(`Unknown operation: ${input.operationId}`)
  }
  const query = parseListPowersInput(input.params)

  // 2. select scope and agent
  const scopeRecords = query.scope === 'installed' ? installedFixtures : marketFixtures
  const agentRecords =
    query.scope === 'installed'
      ? scopeRecords.filter((record) => record.agent === query.agent)
      : scopeRecords

  // 3. derive agents and unfiltered tags facets for the selected agent/type
  const agentsFacet =
    query.scope === 'installed'
      ? sortedUnique(
          installedFixtures
            .map((record) => record.agent)
            .filter((agent): agent is string => agent !== undefined)
        )
      : []
  const tagsFacet = sortedUnique(
    agentRecords
      .filter((record) => record.type === query.type)
      .flatMap((record) => record.tags)
  )

  // partial-agent warning for the selected installed agent, when flagged
  const selectedAgent = query.scope === 'installed' ? query.agent : undefined
  const warnings: PowerWarning[] =
    selectedAgent !== undefined && PARTIALLY_UNAVAILABLE_AGENTS.has(selectedAgent)
      ? [
          {
            code: 'installed-agent-unavailable',
            agent: selectedAgent,
            message: PARTIAL_AGENT_WARNING_MESSAGE,
          },
        ]
      : []

  // 4. apply type and tag OR filters to exact versions
  const filteredRecords = agentRecords.filter((record) => {
    if (record.type !== query.type) return false
    if (query.tags.length === 0) return true
    return record.tags.some((tag) => query.tags.includes(tag))
  })

  // 5. group by type/name
  const grouped = new Map<string, MockPowerRecord[]>()
  for (const record of filteredRecords) {
    const key = `${record.type}\u0000${record.name}`
    const bucket = grouped.get(key)
    if (bucket) bucket.push(record)
    else grouped.set(key, [record])
  }

  // 6. sort versions numerically descending and series by type/name
  const series: PowerSeries[] = [...grouped.values()].map((records) => ({
    type: records[0].type,
    name: records[0].name,
    versions: records
      .map((record) => ({
        version: record.version,
        description: record.description,
        tags: [...record.tags].sort(),
      }))
      .sort((a, b) => compareVersionsDescending(a.version, b.version)),
  }))
  series.sort(compareSeries)

  const total = series.length

  // 9. return reset_required for page>1 snapshot mismatch
  if (query.page > 1 && query.snapshot !== SNAPSHOT) {
    return { status: 'reset_required', reason: 'snapshot_changed' }
  }

  // 7. slice series using pageSize 20
  const start = (query.page - 1) * POWER_PAGE_SIZE
  const pageItems = series.slice(start, start + POWER_PAGE_SIZE)
  const nextPage = start + POWER_PAGE_SIZE < total ? query.page + 1 : undefined

  // 8. return snapshot local-preview-v1
  const base = {
    status: 'ready' as const,
    snapshot: SNAPSHOT,
    items: pageItems,
    page: query.page,
    pageSize: POWER_PAGE_SIZE,
    total,
    facets: { agents: agentsFacet, tags: tagsFacet },
    warnings,
  }
  return nextPage === undefined ? base : { ...base, nextPage }
}
