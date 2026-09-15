/** A fair session coin flip assigns distinct seeds only for tied candidate lists. */
const firstLeads = Math.random() < 0.5
export const EXPLORE_SESSION_SEEDS = {
  vrchat: firstLeads ? 0 : 1,
  chilloutvr: firstLeads ? 1 : 0
} as const
