import { describe, expect, it, vi } from 'vitest'
import { requestCvrImportConsent } from './cvrImportConsent'

describe('remembered CVR import consent', () => {
  it.each(['skip', 'import'] as const)(
    'uses remembered %s without prompting or writing',
    async (choice) => {
      const prompt = vi.fn(async () => false)
      const saveChoice = vi.fn(async () => {})
      expect(await requestCvrImportConsent({ choice, prompt, saveChoice })).toBe(
        choice === 'import'
      )
      expect(prompt).not.toHaveBeenCalled()
      expect(saveChoice).not.toHaveBeenCalled()
    }
  )
  it.each([true, false])(
    'persists the explicit choice before allowing import (%s)',
    async (accepted) => {
      const order: string[] = []
      expect(
        await requestCvrImportConsent({
          choice: 'ask',
          prompt: async () => {
            order.push('prompt')
            return accepted
          },
          saveChoice: async (choice) => {
            order.push(choice)
          }
        })
      ).toBe(accepted)
      expect(order).toEqual(['prompt', accepted ? 'import' : 'skip'])
    }
  )
  it('fails closed if the choice could not be persisted', async () => {
    await expect(
      requestCvrImportConsent({
        choice: 'ask',
        prompt: async () => true,
        saveChoice: async () => {
          throw new Error('synthetic disk failure')
        }
      })
    ).rejects.toThrow('synthetic disk failure')
  })
})
