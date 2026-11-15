# Contributing to Budgero

Contributions are welcome — bug reports, fixes, and features alike. This document
explains how the project works and what a good contribution looks like.

## How this repository works

GitHub is Budgero's primary repository. Issues, pull requests, reviews, and merges
happen here, and accepted contributions are merged directly into `master`.

Pull-request CI runs on GitHub-hosted runners. Builds on `master` run on a dedicated
self-hosted runner. Maintainers retain a separate copy on private infrastructure.

## Before you start

- **Bug fixes and small improvements** — open a PR directly.
- **Features and larger changes** — open an issue first so we can agree on the
  approach before you invest real time. Budgero is maintained by one person, and
  unsolicited large PRs may be declined simply because reviewing them responsibly
  isn't feasible.
- **Security issues** — never via a public issue or PR; see [SECURITY.md](./SECURITY.md).

## Development setup

See the [README](./README.md#development-setup). Short version: Node.js 22+, pnpm 11+,
Go 1.26+, then:

```bash
pnpm install
pnpm run setup:dev
pnpm run dev:selfhost
```

## Quality gates

CI selects checks from the files changed across the whole PR (and the full commit
range on pushes). Every run checks that the app's knowledge base matches
`docs/user` and that the changelog in `docs/changelog` loads. App, core, and
runtime changes run the app checks; server changes run the Go checks. Shared
configuration, lockfiles, the CI workflow and its change selection, and unknown
paths run the full suite. Repository-only prose, metadata,
and other workflows (release, runner checks) skip build steps.

The required `web` and `server` checks still report on every PR; a failed
change-selection job blocks merging. Fork workflow runs may need maintainer
approval before checks appear.

Run the relevant checks locally before opening a PR:

```bash
pnpm run type-check:all   # tsc across core, runtime, app
pnpm run lint:app         # eslint (also :core, :runtime, :server)
pnpm run test:core        # domain logic tests (also test:app, test:server)
pnpm run build:all        # full production build
```

Pre-commit hooks (husky + lint-staged) format and lint staged files automatically.

## Commit style

Terse conventional commits, matching the existing history: `fix(import): …`,
`feat(budget): …`, `chore: …`. No long bodies needed.

## Licensing

- Budgero is licensed [AGPL-3.0-only](./LICENSE). Contributions are accepted under the
  same license (inbound = outbound) — no copyright assignment, no CLA.
- The exception is `packages/sdk-python`, which is MIT-licensed; contributions to it
  are accepted under MIT.
- **Parity promise:** Budgero Cloud and Self-Host are built from this same public
  source with 1:1 feature parity. Your contribution ships in both editions.

## Supporting the project without code

Not every contribution is a pull request. Reporting bugs well, answering other users'
questions, [donating](https://budgero.app/donate), or starring the repository all
genuinely help a one-person project.

## Conduct

Be respectful in issues and discussions. Abusive or harassing behavior can be
reported to hello@budgero.app and may result in interactions being restricted.
