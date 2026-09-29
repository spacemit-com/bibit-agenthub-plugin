import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deleteSource, readCustom, uploadSource } from './custom'

/**
 * The dev scanner mirrors the Go provider's rules, so these tests pin the same
 * contract: mainstream minimum per type, skip reasons for near-misses, and a
 * delete that only ever touches a direct child of the Agent's type directory.
 * `os.homedir()` honours `$HOME` on POSIX, so a temporary home isolates each case.
 */

function withHome<T>(run: (home: string) => T): T {
  const previous = process.env.HOME
  const home = mkdtempSync(join(tmpdir(), 'agenthub-dev-'))
  process.env.HOME = home
  try {
    return run(home)
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

function writeFile(home: string, relative: string, contents: string) {
  const path = join(home, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function scan(home: string, agent: string) {
  const result = readCustom(agent)
  return JSON.parse(result.itemsJson) as {
    items: Array<{ type: string; name: string; version: string; source: string; name_zh?: string }>
    skipped: Array<{ name: string; expected: string; reason: string }>
  }
}

describe('readCustom', () => {
  it('lists a skill that only meets the mainstream minimum', () => {
    withHome((home) => {
      writeFile(home, '.codex/skills/hand-written/SKILL.md', '---\nname: hand-written\ndescription: Hand made.\n---\n')
      const document = scan(home, 'codex')
      expect(document.items).toHaveLength(1)
      expect(document.items[0]).toMatchObject({ type: 'skill', name: 'hand-written', version: '', source: 'custom' })
      expect(document.skipped).toEqual([])
    })
  })

  it('reads display fields and normalizes a bare version', () => {
    withHome((home) => {
      writeFile(
        home,
        '.hermes/skills/local-tool/SKILL.md',
        '---\nname: local-tool\ndescription: Local.\nversion: "1.2.3"\nname_zh: 本地工具\n---\n'
      )
      const document = scan(home, 'hermes-agent')
      expect(document.items[0]).toMatchObject({ version: 'v1.2.3', name_zh: '本地工具' })
    })
  })

  it('shows the declared name instead of the directory for a v1 resource', () => {
    withHome((home) => {
      // Directory and declared name disagree, and there are no v2 display fields.
      writeFile(home, '.bianbu-agent/skills/vi-coder/SKILL.md', '---\nname: vibe-coder\ndescription: Vibe.\n---\n')
      // A real name_en still wins; name_zh alone must not become name_en.
      writeFile(
        home,
        '.bianbu-agent/skills/en-only/SKILL.md',
        '---\nname: en-only\ndescription: D.\nname_en: English Display\n---\n'
      )
      writeFile(home, '.bianbu-agent/skills/zh-only/SKILL.md', '---\nname: zh-only\ndescription: D.\nname_zh: 中文名\n---\n')

      const byName = new Map(scan(home, 'bibit').items.map((item) => [item.name, item]))
      expect(byName.get('vi-coder')).toMatchObject({ name_en: 'vibe-coder' })
      expect(byName.get('vi-coder')?.name_zh).toBeUndefined()
      expect(byName.get('en-only')).toMatchObject({ name_en: 'English Display' })
      expect(byName.get('zh-only')).toMatchObject({ name_zh: '中文名', name_en: 'zh-only' })
    })
  })

  it('lists a plugin from apc-plugin.json and an agent from agent.yaml', () => {
    withHome((home) => {
      writeFile(
        home,
        '.bianbu-agent/plugins/local-bundle/apc-plugin.json',
        JSON.stringify({ name: 'local-bundle', version: 'v0.1.0', description: 'Hand made.' })
      )
      writeFile(
        home,
        '.bianbu-agent/agents/local-agent/agent.yaml',
        'agent:\n  name: local-agent\n  version: v2.0.0\n  description: Local agent.\n  soul: |-\n    Be local.\n'
      )
      const document = scan(home, 'bibit')
      expect(document.items.map((item) => item.name).sort()).toEqual(['local-agent', 'local-bundle'])
      expect(document.skipped).toEqual([])
    })
  })

  it('reports why a near-miss directory was skipped', () => {
    withHome((home) => {
      writeFile(home, '.codex/skills/partial/SKILL.md', '---\nname: partial\n---\n')
      writeFile(home, '.codex/skills/empty/skill-card.md', '# card\n')
      writeFile(home, '.codex/skills/good/SKILL.md', '---\nname: good\ndescription: Fine.\n---\n')
      const document = scan(home, 'codex')
      expect(document.items.map((item) => item.name)).toEqual(['good'])
      expect(document.skipped).toEqual([
        { type: 'skill', name: 'empty', expected: 'SKILL.md', reason: 'missing-authority-file' },
        { type: 'skill', name: 'partial', expected: 'SKILL.md', reason: 'invalid-authority-file' },
      ])
    })
  })

  it('ignores directories the Agent cannot load', () => {
    withHome((home) => {
      writeFile(home, '.codex/plugins/codex-plugin/apc-plugin.json', JSON.stringify({ name: 'codex-plugin' }))
      writeFile(home, '.codex/skills/.system/hidden/SKILL.md', '---\nname: hidden\ndescription: d\n---\n')
      const document = scan(home, 'codex')
      expect(document.items).toEqual([])
      expect(document.skipped).toEqual([])
    })
  })

  it('follows a symlinked skill directory', () => {
    withHome((home) => {
      const linked = mkdtempSync(join(tmpdir(), 'agenthub-linked-'))
      try {
        writeFile(linked, 'linked-skill/SKILL.md', '---\nname: linked-skill\ndescription: Linked.\n---\n')
        mkdirSync(join(home, '.codex/skills'), { recursive: true })
        symlinkSync(join(linked, 'linked-skill'), join(home, '.codex/skills/linked-skill'))
        const document = scan(home, 'codex')
        expect(document.items.map((item) => item.name)).toEqual(['linked-skill'])
      } finally {
        rmSync(linked, { recursive: true, force: true })
      }
    })
  })

  it('returns an empty scan for an absent Agent root and rejects an unknown Agent', () => {
    withHome((home) => {
      expect(scan(home, 'bibit')).toEqual({ items: [], skipped: [] })
      expect(() => readCustom('gpt')).toThrow(/incompatible|Custom resource request/)
    })
  })
})

describe('deleteSource', () => {
  it('removes the resource directory and refuses anything outside it', () => {
    withHome((home) => {
      writeFile(home, '.bianbu-agent/skills/demo/SKILL.md', '---\nname: demo\ndescription: d\n---\n')
      expect(deleteSource({ agent: 'bibit', type: 'skill', name: 'demo' })).toEqual({ status: 'deleted' })
      expect(scan(home, 'bibit').items).toEqual([])
      expect(() => deleteSource({ agent: 'bibit', type: 'skill', name: 'demo' })).toThrow()
      expect(() => deleteSource({ agent: 'bibit', type: 'skill', name: '../escape' })).toThrow()
      expect(() => deleteSource({ agent: 'codex', type: 'plugin', name: 'demo' })).toThrow()
    })
  })
})

describe('uploadSource', () => {
  it('requires a configured key and a valid message before touching apm', async () => {
    await withHomeAsync(async (home) => {
      writeFile(home, '.bianbu-agent/skills/demo/SKILL.md', '---\nname: demo\ndescription: d\n---\n')
      const signal = new AbortController().signal
      await expect(uploadSource({ agent: 'bibit', type: 'skill', name: 'demo' }, 'publish', '', signal)).rejects.toMatchObject(
        { code: 'unauthorized' }
      )
      await expect(uploadSource({ agent: 'bibit', type: 'skill', name: 'demo' }, '  ', 'key', signal)).rejects.toMatchObject(
        { code: 'incompatible' }
      )
      await expect(
        uploadSource({ agent: 'bibit', type: 'skill', name: 'absent' }, 'publish', 'key', signal)
      ).rejects.toMatchObject({ code: 'incompatible' })
    })
  })

  it('reads the failure reason from apm stderr and redacts the key', async () => {
    await withHomeAsync(async (home) => {
      writeFile(home, '.bianbu-agent/skills/demo/SKILL.md', '---\nname: demo\ndescription: d\n---\n')
      const apm = mkdtempSync(join(tmpdir(), 'agenthub-apm-'))
      const script = join(apm, 'apm')
      writeFileSync(
        script,
        '#!/bin/sh\n' +
          'if [ "$1" = validate ]; then\n' +
          '  printf \'level=ERROR msg="command failed" error="missing skill-card.md: %s"\\n\' "$APC_API_KEY" >&2\n' +
          '  printf "Usage:\\n  apm validate <path>\\n" >&2\n' +
          '  exit 1\n' +
          'fi\n' +
          'exit 0\n',
        { mode: 0o755 }
      )
      const previous = process.env.APM_PATH
      process.env.APM_PATH = script
      try {
        const result = await uploadSource(
          { agent: 'bibit', type: 'skill', name: 'demo' },
          'publish',
          'secret-key',
          new AbortController().signal
        )
        expect(result.stage).toBe('validate')
        expect(result.exitCode).toBe(1)
        expect(result.reason).toBe('missing skill-card.md: ***')
      } finally {
        if (previous === undefined) delete process.env.APM_PATH
        else process.env.APM_PATH = previous
        rmSync(apm, { recursive: true, force: true })
      }
    })
  })
})

async function withHomeAsync(run: (home: string) => Promise<void>): Promise<void> {
  const previous = process.env.HOME
  const home = mkdtempSync(join(tmpdir(), 'agenthub-dev-'))
  process.env.HOME = home
  try {
    await run(home)
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}
