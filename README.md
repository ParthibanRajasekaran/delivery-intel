<div align="center">

# 📊 delivery-intel

**Software Delivery Intelligence in one command.**

Point it at any GitHub repo. Get DORA metrics, vulnerability scan, and a health score.\
No setup. No tokens for public repos. Just run it.

[![npm version](https://img.shields.io/npm/v/delivery-intel?color=cb3837&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/delivery-intel)
[![CI](https://img.shields.io/github/actions/workflow/status/ParthibanRajasekaran/delivery-intel/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white)](https://github.com/ParthibanRajasekaran/delivery-intel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node 18+](https://img.shields.io/badge/node-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)

</div>

---

## ⚡ 30-Second Demo

```bash
npx delivery-intel facebook/react
```

```
  ┌─────────────────────────────────────────────────┐
  │  📊 Delivery Intel - Software Delivery Intelligence  │
  └─────────────────────────────────────────────────┘

  Repository:  facebook/react
  Analyzed:    2026-02-18T12:00:00.000Z

  Overall Health Score
  ██████████████████████████░░░░ 87/100

  DORA Metrics  ─────────────────────────────────────

  Deploy Frequency  Elite
  12.4 deployments/week  (source: merged PRs)

  Lead Time  Elite
  3.2 hours median  (0.1 days)

  Change Failure Rate  High
  4.8%  (2 failed / 42 total pipeline runs)

  Vulnerability Scan  (OSV.dev)  ───────────────────
  ✓ No known vulnerabilities found

  Suggestions  ─────────────────────────────────────
  ✓ Looking good, no critical issues detected
```

> Works with full URLs too: `npx delivery-intel https://github.com/vercel/next.js`

---

## 🔍 What It Measures

| Metric | What it tells you | Source |
|--------|-------------------|--------|
| **Deploy Frequency** | How often code ships to production | GitHub Deployments API → merged PRs fallback |
| **Lead Time** | PR creation → merge (branch active duration) | Pull Requests API |
| **Change Failure Rate** | % of CI pipeline runs that failed + raw counts | Workflow Runs API |
| **Vulnerabilities** | Known CVEs in your dependencies | [OSV.dev](https://osv.dev) (free, no auth) |
| **Health Score** | Single 0–100 rollup of everything above | Weighted composite |
| **Suggestions** | Prioritized, actionable recommendations | Heuristic engine |

> Supports `package.json`, `requirements.txt`, and `go.mod` for vulnerability scanning.

---

## 🚀 Quick Start

### CLI (zero install)

```bash
# Any public repo, no token needed
npx delivery-intel facebook/react

# JSON output
npx delivery-intel vercel/next.js --json

# Save report to file
npx delivery-intel vercel/next.js --json --output report.json
```

### Web Dashboard

```bash
git clone https://github.com/ParthibanRajasekaran/delivery-intel.git
cd delivery-intel
npm install
npm run dev
# → http://localhost:3000
```

Paste a repo URL and get an animated dashboard with score ring, DORA cards, charts, vulnerability table, and suggestions. Dark theme with smooth animations.

### Docker

```bash
# Dashboard
docker compose up dashboard

# CLI
REPO=facebook/react docker compose run --rm cli
```

---

## 🔐 Authentication

| Method | Setup | Best for |
|--------|-------|----------|
| **None** | Just run it | Public repos (60 req/hr) |
| **`gh auth login`** | `brew install gh && gh auth login` | Daily use, token stays in OS keychain ✨ |
| **`GITHUB_TOKEN`** | `export GITHUB_TOKEN=ghp_...` | CI environments |
| **`--token`** | `--token ghp_...` | Quick one-off (avoid in CI) |

Token resolution order: `--token` flag → `GITHUB_TOKEN` env → `gh auth token`

> **Private repos** require a token with `repo` scope. For CI, use `${{ secrets.GITHUB_TOKEN }}`. It's auto-scoped and expires per job.

---

## 🔄 CI Integration

Add delivery-intel as a quality gate in your pipeline:

```yaml
# .github/workflows/delivery-intel.yml
name: Delivery Intelligence

on:
  push:
    branches: [main]
  pull_request:

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - name: Run delivery-intel
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx delivery-intel@latest ${{ github.repository }} --json --output report.json

      - name: Check health score
        run: |
          SCORE=$(jq '.score' report.json)
          echo "Health score: $SCORE / 100"
          if (( $(echo "$SCORE < 40" | bc -l) )); then
            echo "::error::Score $SCORE is below threshold (40)"
            exit 1
          fi
```

> A ready-to-use workflow file is included at [.github/workflows/delivery-intel.yml](.github/workflows/delivery-intel.yml).

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      delivery-intel                          │
├──────────────┬───────────────┬───────────────────────────────┤
│   CLI        │   Dashboard   │   GitHub Action               │
│  (npx)       │  (Next.js)    │   (workflow)                  │
├──────────────┴───────────────┴───────────────────────────────┤
│                  Shared Analysis Engine                       │
├──────────┬────────────┬──────────────┬───────────────────────┤
│ GitHub   │ OSV.dev    │  Metrics     │  Suggestions          │
│ REST API │ Vuln API   │  Engine      │  Engine               │
│ GraphQL  │            │  (DORA)      │  (Heuristics)         │
├──────────┴────────────┴──────────────┴───────────────────────┤
│               Optional: Redis Cache (ioredis)                │
└──────────────────────────────────────────────────────────────┘
```

---

## 🛠 Tech Stack

<table>
<tr>
<td><strong>Runtime</strong></td>
<td>TypeScript · Node.js 18+ · Next.js (App Router)</td>
</tr>
<tr>
<td><strong>GitHub</strong></td>
<td><code>@octokit/rest</code> · <code>@octokit/graphql</code></td>
</tr>
<tr>
<td><strong>Visualization</strong></td>
<td>Recharts · Framer Motion · Tailwind CSS</td>
</tr>
<tr>
<td><strong>Security</strong></td>
<td>OSV.dev (free, no auth)</td>
</tr>
<tr>
<td><strong>Caching</strong></td>
<td>ioredis (optional, degrades gracefully)</td>
</tr>
<tr>
<td><strong>Quality</strong></td>
<td>ESLint · Prettier · Husky · Vitest · GitHub Actions CI</td>
</tr>
</table>

---

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, coding standards, and workflow.

```bash
git clone https://github.com/ParthibanRajasekaran/delivery-intel.git
cd delivery-intel
npm install
npm run validate   # lint + typecheck + test in one shot
```

---

## 📄 License

[MIT](LICENSE). Use it however you want.
