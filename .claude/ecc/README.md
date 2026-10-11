# ECC tooling (vendored subset)

Agents, skills, commands and rules copied from https://github.com/affaan-m/ECC
(formerly `everything-claude-code`), version 2.2.3, commit 8ce348f. MIT licensed, see LICENSE here.

Only a subset is vendored: the `orch-*` orchestration skills and the agents/skills they call
(planner, tdd-guide, code-reviewer, security-reviewer, ...), plus testing, security, Next.js,
migration, Docker and deploy skills. Nothing here installs hooks or edits global settings.

- `rules/` is reference only (not auto-loaded). The orch pipeline points at it.
- Postgres-specific, multi-model (`multi-*`) and design skills are intentionally left out:
  the design direction comes from UI UX Pro Max (milestone 6) and Impeccable (milestone 8).
- To refresh: re-copy from a new upstream clone and review the diff before committing.

## UI UX Pro Max (milestone 6)

`.claude/skills/ui-ux-pro-max/` is a project-local copy of the skill from https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (MIT).
Local data and Python scripts only (standard library, no network). Used as an idea bank for styles, palettes, type pairings and chart guidance.
Its generated design systems were generic, so the actual design came from the owner's references and rounds of review (see `docs/design/`).
