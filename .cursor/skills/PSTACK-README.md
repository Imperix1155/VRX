# Optional pstack skills

These four skills are copied from [pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT, see `PSTACK-LICENSE`), source commit `35a90942a7f02e1ebbc2443643179815f2147954`, so Cursor cloud agents can load them:

- `poteto-mode`: the overall working style and playbooks (its `scripts/` folder is left out).
- `principle-fix-root-causes`: fix the fault where it started, not where it surfaced.
- `principle-prove-it-works`: verify against the real artifact before calling work done.
- `blast-radius`: find what a change breaks outside its diff, and prove the one fact it is safe because of.

They are optional helpers, not requirements. Nothing in VRX depends on them, and `AGENTS.md` and the nearer contracts always win. `poteto-mode` names other pstack skills that are not copied here; skip those steps when a skill is missing.

To refresh, copy the same four folders from the latest pstack, drop `poteto-mode/scripts/`, and update the commit above.
