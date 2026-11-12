# AGENTS.md

## Development

- Use the Node.js version required by `devEngines.runtime` and the pnpm version specified in `packageManager` in `package.json`. Use `pn` for pnpm commands.
- Install dependencies with `pn install --frozen-lockfile`.
- When changing code or related configuration, run the checks used by CI:
  - `pn check-ci` — check lint and formatting.
  - `pn type:check` — check TypeScript types.
  - `pn build` — build the library.

## Testing

Tests use Vitest with Browser Mode and Playwright for browser-dependent behavior in headless Chromium. Browser-independent tests run directly in Node.js. Tests are in `src/**/*.test.ts`; shared fixtures are in `test/fixtures`.

After installing the project dependencies, install Chromium once:

```bash
pn exec playwright install chromium
```

- `pn test` — run the test suite once.
- `pn test:watch` — start Vitest in watch mode while developing.
- `pn test:coverage` — run the suite and generate the coverage report.

Add or update tests for behavior changes. Before completing code changes, run `pn test:coverage` and keep the existing 100% coverage thresholds for branches, functions, lines, and statements defined in `vitest.config.ts`.

## Documentation

- Keep `README.md` and `docs/` focused on installation, usage, and the library's public API.
- Keep operational instructions for coding agents in `AGENTS.md`.
- Update the relevant user documentation when public behavior changes.
