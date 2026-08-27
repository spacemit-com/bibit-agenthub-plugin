import { describe, expect, it } from 'vitest'
import { featureModule } from './feature'

describe('featureModule', () => {
  it('exports the declared home and settings renderers', () => {
    expect(featureModule.sdkApiVersion).toBe(1)
    expect(featureModule.pages?.home).toBeTypeOf('function')
    expect(featureModule.settings?.settings).toBeTypeOf('function')
  })
})
