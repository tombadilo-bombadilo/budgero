# Budgero i18n

Target locales: German, French, Spanish, Dutch, alongside English.

`glossary.json` is the source of truth for Budgero's terms of art. Every translated
string in the app, the landers, and the docs must use these exact terms. Inconsistent
domain vocabulary is what makes a localized app feel broken, so the glossary is
reviewed and locked before any bulk translation runs.

## Workflow

```bash
node i18n/scripts/glossary.mjs status              # review progress per locale
node i18n/scripts/glossary.mjs export [locale...]  # -> i18n/review-sheets/glossary-<locale>.csv
node i18n/scripts/glossary.mjs import <locale> <file.csv>
```

1. `export` produces a CSV per locale.
2. Send it to a native reviewer. They need no repo access and no JSON.
3. `import` merges corrections back and flips those terms to `reviewed`.
4. Once a locale is 100% reviewed, its terms are set to `locked` and the translation
   pipeline may run against it.

## Term status

| status | meaning |
|---|---|
| `proposed` | LLM-proposed, not native-verified. **Never ship.** |
| `reviewed` | A native speaker read and corrected it. |
| `locked` | Final. The translation pipeline must reproduce it exactly. |

The review branch locked all 46 translatable glossary terms in German, French, Spanish, and Dutch. Keep those terms consistent when adding copy.

## Instructions to send with a review sheet

> This is the core vocabulary of a budgeting app. These ~44 terms repeat constantly
> throughout the product, so they need to be right and internally consistent — every
> other translated string is built on top of them.
>
> - `what_it_means` and `where_it_appears` give you the context. A word like
>   "Available" or "Clear" is ambiguous without it — please read these before deciding.
> - Fill **YOUR_CORRECTION** only if the proposal is wrong or unnatural. Leave it blank
>   if the proposal is good, and put `y` in **OK_AS_IS** so we know you read the row
>   rather than skipped it.
> - `length_limit: tight` means the term goes in a button or a table column. A shorter
>   approximate word beats a longer precise one there. Flag anything that will not fit.
> - Use **YOUR_COMMENTS** for doubts, alternatives, or "technically right but nobody
>   says this."
> - The most important judgement: does this read like it was written by someone in your
>   language, or like it was translated from English? Flag the latter.
>
> The highest-priority rows are `ready_to_assign`, `assign`, `assigned`, `activity`,
> `available`, `payee`, `transaction`, and `cleared` — they appear on nearly every screen.

## Coverage

App strings and all documentation guides in `docs/user` have German, French, Spanish, and Dutch versions (`docs/user/<locale>/`). Historical changelog entries stay in English. The website's own catalogs and checks live in the website repository.

The new translations have automated coverage, placeholder, and rendering checks. They have not received a new native-speaker review.

## Development checks

```bash
pnpm --dir packages/app exec lingui extract --clean
pnpm --dir packages/app exec lingui compile --strict
pnpm run i18n:check
pnpm run i18n:sweep
pnpm run test:app
```

Translate complete messages and use ICU plurals for counts. Never translate storage keys, identifiers, source data, or analytics event names. Module-level Lingui `msg` values are descriptors: resolve them with `t(descriptor)` or `i18n._(descriptor)` before passing them to libraries that require strings. React components must subscribe with `useLingui()` when using translated values in memoized data.

`i18n:check` covers the app catalogs and checks that every English guide in `docs/user` has a counterpart with the same `topicId` in each locale. `i18n:sweep` is a conservative source audit; a clean report does not replace rendered-page checks.
