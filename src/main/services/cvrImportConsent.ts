import type { Settings } from '@shared/settings'

interface CvrImportConsentOptions {
  choice: Settings['cvrSessionImportChoice']
  prompt: () => Promise<boolean>
  saveChoice: (choice: 'import' | 'skip') => Promise<void>
}

/** No discovery here. A failed decision write fails closed at the bootstrap boundary. */
export async function requestCvrImportConsent({
  choice,
  prompt,
  saveChoice
}: CvrImportConsentOptions): Promise<boolean> {
  if (choice !== 'ask') return choice === 'import'
  const accepted = (await prompt()) === true
  await saveChoice(accepted ? 'import' : 'skip')
  return accepted
}
