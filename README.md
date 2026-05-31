# tsprune

Find unused exports in your TypeScript project — dead code that's exported but never imported anywhere.

## Why?

Your `index.ts` exports 50 things. Half of them haven't been used in months. They add noise, confuse newcomers, and bloat your bundle. `tsprune` tells you exactly which exports are gathering dust.

Unlike general dead code tools, tsprune focuses specifically on the **export boundary** — things you've chosen to make public. If nobody's using them, why are they exported?

## Install

```bash
npm install -g tsprune
```

## Usage

```bash
# Scan current directory
tsprune .

# Scan specific path
tsprune src

# JSON output for scripts/CI
tsprune . --json

# Markdown report
tsprune . --markdown

# Skip type-only exports (interfaces, type aliases)
tsprune . --ignore-types
```

## Output

```
Found 3 unused exports in 12 files

  src/utils/format.ts
    → formatDate (function) line 14
    → parseDate (function) line 28

  src/types.ts
    → LegacyConfig (interface) (type) line 45

Summary: 3/47 unused (6%)
```

Exit codes:
- `0` — no unused exports found
- `1` — unused exports found (CI-friendly)

## CI Integration

```yaml
# GitHub Actions
- name: Check for unused exports
  run: npx tsprune src --ignore-types
```

The `--json` flag gives you a full report you can process further:

```bash
tsprune . --json | jq '.unused[] | .name'
```

## How It Works

1. Scans your project for `.ts`/`.tsx`/`.js`/`.jsx` files (skips `node_modules`, `dist`, `.git`, test files, `.d.ts`)
2. Parses all `export` declarations
3. Parses all `import` declarations
4. Resolves relative import paths to actual files
5. Matches imports to exports
6. Anything exported but never imported = unused

## What It Detects

- `export function`
- `export class`
- `export const/let/var`
- `export type`
- `export interface`
- `export enum`
- `export default`
- `export { ... }` named groups
- Re-exports with aliases (`export { foo as bar }`)

## Limitations

- Only tracks relative imports (`./`, `../`). Package imports from `node_modules` are not resolved.
- Dynamic imports (`import()`) and re-exports (`export * from`) are partially handled.
- If you use path aliases (e.g., `@/utils`), configure your resolver separately. tsprune works with plain relative paths.

## API

```typescript
import { scan, formatTable, formatJson, formatMarkdown } from "tsprune";

const result = scan("./src", { ignoreTypes: true });

console.log(formatTable(result));
// or
console.log(formatJson(result));
// or
console.log(formatMarkdown(result));
```

## License

MIT
