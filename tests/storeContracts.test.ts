import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAgentHubSettings, parseAgentSummaries } from '../src/storeContracts.ts'

test('accepts Agent Hub v1 responses', () => {
  assert.deepEqual(parseAgentSummaries([
    { id: 'release-notes', name: 'Release Notes', description: 'Creates release notes.' },
  ]), [
    { id: 'release-notes', name: 'Release Notes', description: 'Creates release notes.' },
  ])
  assert.deepEqual(parseAgentHubSettings({ showExperimental: true, refreshMinutes: 30 }), {
    showExperimental: true,
    refreshMinutes: 30,
  })
})

test('rejects malformed Store responses', () => {
  assert.throws(() => parseAgentSummaries({ items: [] }), /incompatible Agent list/)
  assert.throws(() => parseAgentSummaries([{ id: 'missing-fields' }]), /incompatible Agent list/)
  assert.throws(
    () => parseAgentHubSettings({ showExperimental: true, refreshMinutes: 121 }),
    /incompatible Agent Hub settings/,
  )
})
