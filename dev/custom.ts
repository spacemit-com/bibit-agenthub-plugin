import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Dev-only implementation of the three custom-resource operations for Local
 * Preview. It mirrors the Go provider's rules (which files mark a candidate, what
 * the mainstream minimum of each Power type is, which path a delete may touch)
 * against the machine running the preview server, so the Feature Dev Host can
 * show real hand-installed resources without a board.
 *
 * It deliberately keeps its own narrow YAML reader instead of pulling in a
 * dependency: the preview must not behave differently from the provider just
 * because a parser was convenient.
 */

const MAX_ENTRIES = 200
const MAX_ITEMS = 1000
const MAX_FILE_BYTES = 64 << 10
const MAX_SKIPPED = 20
const WRITE_TIMEOUT_MS = 120_000
const MAX_REASON = 300

const AGENT_ROOTS: Record<string, string> = {
  bibit: '.bianbu-agent',
  codex: '.codex',
  'claude-code': '.claude',
  'hermes-agent': '.hermes',
}

// MCP is absent on purpose: apm registers MCP servers into the Agent's own
// configuration or CLI, so there is no directory to scan. codex and claude-code
// manage Plugins through their own CLI (marketplace + cache), so a hand-dropped
// plugin directory is not a resource those Agents can load.
const AGENT_TYPES: Record<string, string[]> = {
  bibit: ['skill', 'plugin', 'expert'],
  codex: ['skill'],
  'claude-code': ['skill'],
  'hermes-agent': ['skill', 'plugin'],
}

type TypeSpec = {
  dir: string
  authority: string[]
  candidates: string[]
  extraCandidate?: string
}

const TYPE_SPECS: Record<string, TypeSpec> = {
  skill: { dir: 'skills', authority: ['SKILL.md'], candidates: ['SKILL.md', 'skill-card.md'] },
  plugin: {
    dir: 'plugins',
    authority: ['apc-plugin.json', 'plugin.yaml', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json'],
    candidates: ['apc-plugin.json', 'plugin.yaml', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json'],
    extraCandidate: 'skills',
  },
  // The key is the Power type; `dir` and the authority file are what APC and the
  // Bibit runtime already use, so they keep their names (apm ADR-044).
  expert: { dir: 'agents', authority: ['agent.yaml'], candidates: ['agent.yaml'] },
}

const VERSION_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const POWER_NAME_PATTERN = /^[a-z0-9-]+$/

export class CustomSourceError extends Error {
  constructor(
    readonly code: 'unavailable' | 'incompatible' | 'unauthorized',
    readonly retryable: boolean,
    message: string
  ) {
    super(message)
  }
}

function unavailable(): CustomSourceError {
  return new CustomSourceError('unavailable', true, 'Custom resource scan is unavailable')
}
function incompatible(): CustomSourceError {
  return new CustomSourceError('incompatible', false, 'Custom resource request is incompatible')
}

function agentRoot(agent: string): string {
  const relative = AGENT_ROOTS[agent]
  if (!relative) throw incompatible()
  return join(homedir(), relative)
}

function typeDir(agent: string, type: string): string {
  const spec = TYPE_SPECS[type]
  if (!spec || !(AGENT_TYPES[agent] ?? []).includes(type)) throw incompatible()
  return join(agentRoot(agent), spec.dir)
}

function isCanonicalName(name: string): boolean {
  if (name.length < 1 || name.length > 64 || name.startsWith('-') || name.endsWith('-') || name.includes('--')) {
    return false
  }
  return POWER_NAME_PATTERN.test(name)
}

function statOrNull(path: string) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function isDirectory(path: string): boolean {
  const info = statOrNull(path)
  return info !== null && info.isDirectory()
}

// statSync follows symlinks, matching the provider's `Stat`-based directory test:
// a linked skill directory (a common development layout) is listed, and deleting
// it removes the link rather than the content it points at.
function readTextFile(path: string): string | null {
  try {
    const info = statSync(path)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

type ParsedAuthority = {
  version: string
  description: string
  name_zh?: string
  name_en?: string
  description_zh?: string
}

function parseYamlSubset(contents: string): Map<string, string> {
  const fields = new Map<string, string>()
  const stack: Array<{ indent: number; key: string }> = []
  let ignoreIndent = -1
  const lines = contents.replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/[ \t]+$/, '')
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const indent = countLeadingSpaces(line)
    if (line[indent] === '\t') continue
    const trimmed = line.slice(indent)
    if (ignoreIndent >= 0) {
      if (indent > ignoreIndent) continue
      ignoreIndent = -1
    }
    if (indent === 0 && (trimmed === '---' || trimmed === '...')) {
      stack.length = 0
      continue
    }
    if (trimmed.startsWith('- ') || trimmed === '-' || trimmed.startsWith('? ')) {
      ignoreIndent = indent
      continue
    }
    const separator = mappingSeparator(trimmed)
    if (separator < 0) continue
    const key = unquote(trimmed.slice(0, separator).trim())
    if (key === '' || /[[\]{},&*!|>%@`]/.test(key)) continue
    const rawValue = trimmed.slice(separator + 1).trim()
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    const path = stack.length > 0 ? `${stack[stack.length - 1].key}.${key}` : key
    // A block scalar keeps its value on the following lines, mirroring the Go
    // provider's reader so the Dev Host and a real CLI agree on what is listed.
    const block = blockScalarIndicator(rawValue)
    if (block !== null) {
      const consumed = readBlockScalar(lines, index + 1, indent)
      const value = renderBlockScalar(consumed.block, block)
      if (value !== '') fields.set(path, value)
      index = consumed.last
      continue
    }
    if (rawValue === '') {
      stack.push({ indent, key: path })
      continue
    }
    if (rawValue.startsWith('{') || rawValue.startsWith('[')) continue
    const value = unquote(stripInlineComment(rawValue))
    if (value !== '') fields.set(path, value)
  }
  return fields
}

function countLeadingSpaces(line: string): number {
  let indent = 0
  while (indent < line.length && line[indent] === ' ') indent += 1
  return indent
}

/** `|`/`>` plus optional chomping and indentation indicators, or null. */
function blockScalarIndicator(value: string): 'literal' | 'folded' | null {
  if (value === '' || (value[0] !== '|' && value[0] !== '>')) return null
  if (!/^[|>][+-]?\d*$/.test(value)) return null
  return value[0] === '|' ? 'literal' : 'folded'
}

/**
 * Consumes the indented lines that belong to a block scalar starting at `start`.
 * The block's own indentation is whatever its first non-blank content line uses,
 * matching YAML's indentation detection; the first line indented less than the
 * header ends it.
 */
function readBlockScalar(lines: string[], start: number, headerIndent: number): { block: string[]; last: number } {
  const block: string[] = []
  let contentIndent = -1
  let last = start - 1
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].replace(/[ \t]+$/, '')
    if (line.trim() === '') {
      block.push('')
      continue
    }
    const indent = countLeadingSpaces(line)
    if (indent <= headerIndent || line[indent] === '\t') break
    if (contentIndent < 0) contentIndent = indent
    block.push(line.slice(Math.min(contentIndent, indent)))
    last = index
  }
  while (block.length > 0 && block[block.length - 1] === '') block.pop()
  return { block, last }
}

/** `|` keeps line breaks; `>` folds them into spaces and `\n` between paragraphs. */
function renderBlockScalar(lines: string[], style: 'literal' | 'folded'): string {
  if (style === 'literal') return lines.join('\n').trim()
  const paragraphs: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push(current.join(' '))
        current = []
      }
      continue
    }
    current.push(line.trim())
  }
  if (current.length > 0) paragraphs.push(current.join(' '))
  return paragraphs.join('\n').trim()
}

function mappingSeparator(line: string): number {
  let quote = ''
  for (let index = 0; index < line.length; index++) {
    const character = line[index]
    if (quote !== '') {
      if (character === quote) quote = ''
      else if (character === '\\' && quote === '"') index++
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === ':' && (index + 1 === line.length || line[index + 1] === ' ')) return index
    else if (character === '#' && index > 0 && line[index - 1] === ' ') return -1
  }
  return -1
}

function stripInlineComment(value: string): string {
  let quote = ''
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (quote !== '') {
      if (character === quote) quote = ''
      else if (character === '\\' && quote === '"') index++
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '#' && index > 0 && (value[index - 1] === ' ' || value[index - 1] === '\t')) {
      return value.slice(0, index).trim()
    }
  }
  return value.trim()
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\nt])/g, (_, escape: string) =>
      escape === 'n' ? '\n' : escape === 't' ? '\t' : escape
    )
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

function normalizeVersion(value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return ''
  const candidate = trimmed.startsWith('v') ? trimmed : `v${trimmed}`
  return VERSION_PATTERN.test(candidate) ? candidate : ''
}

function fieldsToAuthority(fields: Map<string, string>, prefix: string): ParsedAuthority {
  const read = (key: string) => (fields.get(prefix + key) ?? '').trim()
  const authority: ParsedAuthority = {
    version: normalizeVersion(fields.get(prefix + 'version')),
    description: read('description'),
  }
  const nameZH = read('name_zh')
  // Mirrors the provider: the authority file's own name is the display fallback,
  // because the directory is only the APM call name used for identity. Every
  // type's minimum-format gate has already rejected a blank name.
  const nameEN = read('name_en') || read('name')
  const descriptionZH = read('description_zh')
  if (nameZH !== '') authority.name_zh = nameZH
  if (nameEN !== '') authority.name_en = nameEN
  if (descriptionZH !== '') authority.description_zh = descriptionZH
  return authority
}

function parseAuthority(path: string, type: string): ParsedAuthority | null {
  const contents = readTextFile(path)
  if (contents === null) return null
  if (type === 'skill') {
    const normalized = contents.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').split('\n')
    if ((normalized[0] ?? '').trim() !== '---') return null
    const end = normalized.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (end < 0) return null
    const fields = parseYamlSubset(normalized.slice(1, end).join('\n'))
    if (!fields.get('name') || !fields.get('description')) return null
    return fieldsToAuthority(fields, '')
  }
  if (path.endsWith('.json')) {
    let decoded: unknown
    try {
      decoded = JSON.parse(contents)
    } catch {
      return null
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null
    const fields = new Map<string, string>()
    for (const [key, value] of Object.entries(decoded as Record<string, unknown>)) {
      if (typeof value === 'string') fields.set(key, value)
    }
    if (type === 'plugin') {
      if (!fields.get('name')) return null
      return fieldsToAuthority(fields, '')
    }
    return null
  }
  const fields = parseYamlSubset(contents)
  if (type === 'plugin') {
    if (!fields.get('name')) return null
    return fieldsToAuthority(fields, '')
  }
  if (!fields.get('agent.name')) return null
  return fieldsToAuthority(fields, 'agent.')
}

function authorityFor(dir: string, spec: TypeSpec): { found: boolean; file?: string } {
  for (const authority of spec.authority) {
    if (statOrNull(join(dir, authority))?.isFile()) return { found: true, file: authority }
  }
  for (const candidate of spec.candidates) {
    if (statOrNull(join(dir, candidate))?.isFile()) return { found: true }
  }
  if (spec.extraCandidate && isDirectory(join(dir, spec.extraCandidate))) return { found: true }
  return { found: false }
}

export interface CustomListResult {
  scope: 'custom'
  status: 'data'
  itemsJson: string
}

export function readCustom(agent: string): CustomListResult {
  if (!AGENT_ROOTS[agent]) throw incompatible()
  const items: Array<Record<string, unknown>> = []
  const skipped: Array<Record<string, string>> = []
  for (const type of AGENT_TYPES[agent]) {
    const spec = TYPE_SPECS[type]
    const dir = typeDir(agent, type)
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      // A missing type directory is simply "no custom resources".
      continue
    }
    // `readdir` order is filesystem-dependent; sorting keeps the scan (and the
    // snapshot derived from it) stable between two identical reads.
    entries.sort()
    if (entries.length > MAX_ENTRIES) entries = entries.slice(0, MAX_ENTRIES)
    for (const name of entries) {
      if (name.startsWith('.') || !isCanonicalName(name)) continue
      const resourceDir = join(dir, name)
      if (!isDirectory(resourceDir)) continue
      const authority = authorityFor(resourceDir, spec)
      if (!authority.found) continue
      if (authority.file === undefined) {
        if (skipped.length < MAX_SKIPPED) {
          skipped.push({ type, name, expected: spec.authority[0], reason: 'missing-authority-file' })
        }
        continue
      }
      const parsed = parseAuthority(join(resourceDir, authority.file), type)
      if (parsed === null) {
        if (skipped.length < MAX_SKIPPED) {
          skipped.push({ type, name, expected: spec.authority[0], reason: 'invalid-authority-file' })
        }
        continue
      }
      items.push({
        type,
        name,
        version: parsed.version,
        description: parsed.description,
        tags: [],
        source: 'custom',
        ...(parsed.name_zh !== undefined ? { name_zh: parsed.name_zh } : {}),
        ...(parsed.name_en !== undefined ? { name_en: parsed.name_en } : {}),
        ...(parsed.description_zh !== undefined ? { description_zh: parsed.description_zh } : {}),
      })
    }
  }
  items.sort((left, right) =>
    String(left.type) === String(right.type)
      ? String(left.name) < String(right.name)
        ? -1
        : 1
      : String(left.type) < String(right.type)
        ? -1
        : 1
  )
  return {
    scope: 'custom',
    status: 'data',
    itemsJson: JSON.stringify({ items: items.slice(0, MAX_ITEMS), skipped }),
  }
}

export interface CustomTarget {
  agent: string
  type: string
  name: string
}

export interface UploadResult {
  status: 'exited'
  exitCode: number
  stage: 'validate' | 'submit'
  reason?: string
  stdout?: string
}

/** Resolves the resource directory a write may touch, rejecting anything else. */
function resolveTarget(target: CustomTarget): string {
  if (!isCanonicalName(target.name)) throw incompatible()
  const dir = typeDir(target.agent, target.type)
  if (!isDirectory(dir)) throw incompatible()
  const path = join(dir, target.name)
  if (dirname(path) !== dir) throw incompatible()
  if (!isDirectory(path)) throw incompatible()
  return path
}

const APM_UNAVAILABLE = 'apm CLI is unavailable'

function runApm(
  argv: string[],
  signal: AbortSignal,
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CustomSourceError('unavailable', true, APM_UNAVAILABLE))
      return
    }
    const child = spawn(process.env.APM_PATH ?? 'apm', argv, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let failed = false
    const killGroup = () => {
      if (child.pid === undefined) {
        child.kill('SIGKILL')
        return
      }
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    const onAbort = () => killGroup()
    signal.addEventListener('abort', onAbort)
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      run()
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (Buffer.byteLength(stdout, 'utf8') > MAX_FILE_BYTES * 16) {
        failed = true
        killGroup()
      }
    })
    // apm reports a *failure* on stderr (a slog line plus Cobra's usage block), so
    // the stderr prefix is kept bounded rather than discarded.
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 8 << 10) stderr += chunk.toString('utf8')
    })
    child.on('error', () => finish(() => reject(new CustomSourceError('unavailable', true, APM_UNAVAILABLE))))
    child.on('close', (code) => {
      finish(() => {
        if (failed) {
          reject(new CustomSourceError('unavailable', true, APM_UNAVAILABLE))
          return
        }
        resolve({ stdout, stderr, exitCode: code ?? -1 })
      })
    })
  })
}

/**
 * The actionable sentence of a failed apm command. apm logs its failure as a
 * slog logfmt line (`level=ERROR msg="command failed" error="…"`) on stderr and
 * leaves stdout empty, so the `error` attribute is the reason; the usage block
 * that follows it is not.
 */
function failureReason(output: { stdout: string; stderr: string }, apiKey: string): string {
  const extracted = logfmtAttribute(output.stderr, 'error')
  if (extracted !== '') return sanitize(extracted, apiKey)
  const trimmed = output.stdout.trim()
  if (trimmed !== '') return sanitize(trimmed, apiKey)
  return sanitize(output.stderr, apiKey)
}

function logfmtAttribute(text: string, key: string): string {
  for (const line of text.split('\n')) {
    const marker = `${key}="`
    const start = line.indexOf(marker)
    if (start < 0) continue
    let value = ''
    let index = start + marker.length
    let closed = false
    while (index < line.length) {
      const character = line[index]
      if (character === '\\' && index + 1 < line.length) {
        const escape = line[index + 1]
        value += escape === 'n' ? '\n' : escape === 't' ? '\t' : escape === 'r' ? '\r' : escape
        index += 2
        continue
      }
      if (character === '"') {
        closed = true
        break
      }
      value += character
      index += 1
    }
    if (closed) return value.trim()
  }
  return ''
}

function sanitize(output: string, apiKey: string): string {
  let text = output.slice(0, 8 << 10)
  if (apiKey !== '') text = text.split(apiKey).join('***')
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_REASON)
}

export async function uploadSource(
  target: CustomTarget,
  message: string,
  apiKey: string,
  signal: AbortSignal
): Promise<UploadResult> {
  const path = resolveTarget(target)
  if (message.trim() === '' || message.length > 200 || /[\u0000-\u001f\u007f]/.test(message)) throw incompatible()
  if (apiKey === '') throw new CustomSourceError('unauthorized', false, 'APC API Key is not configured')
  const env = { ...process.env, APC_API_KEY: apiKey }
  const deadline = withDeadline(signal, WRITE_TIMEOUT_MS)
  try {
    const validation = await runApm(['validate', path, `--type=${target.type}`, '--json'], deadline.signal, env)
    if (validation.exitCode !== 0) {
      return {
        status: 'exited',
        exitCode: validation.exitCode,
        stage: 'validate',
        reason: failureReason(validation, apiKey),
      }
    }
    const submission = await runApm(
      ['submit', path, `--type=${target.type}`, `--message=${message}`],
      deadline.signal,
      env
    )
    if (submission.exitCode !== 0) {
      return {
        status: 'exited',
        exitCode: submission.exitCode,
        stage: 'submit',
        reason: failureReason(submission, apiKey),
      }
    }
    return {
      status: 'exited',
      exitCode: 0,
      stage: 'submit',
      stdout: sanitize(submission.stdout, apiKey),
    }
  } finally {
    deadline.cleanup()
  }
}

export function deleteSource(target: CustomTarget): { status: 'deleted' } {
  const path = resolveTarget(target)
  // `force` matches the provider's RemoveAll for a directory, but the resolved
  // path has already been proven to be a direct child of the Agent's type dir.
  rmSync(path, { recursive: true, force: true })
  return { status: 'deleted' }
}

function withDeadline(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort)
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    },
  }
}
