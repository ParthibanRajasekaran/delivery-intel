# Contributing to delivery-intel

Thanks for considering contributing. Here's how to get started.

## Development Setup

```bash
git clone https://github.com/ParthibanRajasekaran/delivery-intel.git
cd delivery-intel
npm install
```

## Available Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start the Next.js dashboard in dev mode |
| `npm run build` | Production build of the dashboard |
| `npm run build:cli` | Compile the standalone CLI |
| `npm run lint` | Run ESLint across the codebase |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format all files with Prettier |
| `npm run format:check` | Check formatting without modifying files |
| `npm run typecheck` | Run TypeScript compiler in check mode |
| `npm run test` | Run unit tests with Vitest |
| `npm run test:coverage` | Run tests with coverage report |

## Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Make sure all quality gates pass locally:
   ```bash
   npm run lint && npm run typecheck && npm run test
   ```
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/) — the pre-commit hook will lint and format staged files automatically
5. Open a pull request against `main`

## Pre-commit Hooks

This repo uses [Husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged) to enforce quality before code reaches the repo:

- **pre-commit**: Runs ESLint and Prettier on staged files
- **pre-push**: Runs the TypeScript compiler to catch type errors

These run automatically — no setup needed after `npm install`.

## Code Style

- TypeScript everywhere
- Use `type` imports (`import type { ... }`) — enforced by ESLint
- Prefer `const` over `let`, never use `var`
- Strict equality (`===`), always use curly braces

## Testing

We use [Vitest](https://vitest.dev/) for testing. Tests live next to the code they test in `__tests__` directories.

```bash
# Run tests
npm run test

# Run with coverage
npm run test:coverage
```

Coverage thresholds are enforced in CI — PRs that drop coverage below the threshold will fail.

## Reporting Issues

Use [GitHub Issues](https://github.com/ParthibanRajasekaran/delivery-intel/issues). Please include:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Any relevant error output
