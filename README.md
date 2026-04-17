<div align="center">

# 📊 delivery-intel

**Software Delivery Intelligence in one command.**

Point it at any GitHub repo. Get DORA metrics, vulnerability scan, and a health score.\
No setup. No tokens for public repos. Just run it.

[![npm version](https://img.shields.io/npm/v/delivery-intel?color=cb3837&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/delivery-intel)
[![npm downloads](https://img.shields.io/npm/dw/delivery-intel?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/delivery-intel)
[![CI](https://img.shields.io/github/actions/workflow/status/ParthibanRajasekaran/delivery-intel/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white)](https://github.com/ParthibanRajasekaran/delivery-intel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node 18+](https://img.shields.io/badge/node-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)

</div>

> ### Why DORA metrics matter
>
> Google's [2024 DORA Report](https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report) (32,000+ respondents, 10 years of data) quantifies the gap between elite and low-performing engineering teams:
>
> | Metric | Elite teams | Low performers | Gap |
> |--------|------------|----------------|-----|
> | **Deploy Frequency** | On-demand (multiple/day) | < once per 6 months | **973×** |
> | **Lead Time for Changes** | < 1 hour | 1 – 6 months | **6,570×** |
> | **Change Failure Rate** | 0–15% | 46–60% | — |
> | **Time to Restore** | < 1 hour | 1 week – 1 month | **6,570×** |
>
> Elite teams are **2× more likely to meet reliability targets** and **1.8× more likely to meet business goals** (DORA 2024). delivery-intel tells you exactly where your team stands — in one command.

---

## ⚡ Quick Start

```bash
npx delivery-intel facebook/react
```

```
  ┌─────────────────────────────────────────────────────────┐
  │  📡 Delivery Intel  — Cyber-Diagnostic Report 2026      │
  └─────────────────────────────────────────────────────────┘

  Repository    facebook/react
  Scanned       2026-04-17T12:00:00.000Z

  ╭─────────────────────────────────────────────────────╮
  │  ⬡  Overall Health Score                            │
  │                                                     │
  │  ██████████████████████████░░░░  87/100  EXCELLENT  │
  ╰─────────────────────────────────────────────────────╯

  ◈  DORA Metrics
  ────────────────────────────────────────────────────────

  Deploy Frequency     ★ Elite
  12.4 deployments/week  (merged PRs)
  Last 7 days  ▃▄▅▆▇█▇

  Lead Time            ★ Elite
  3.2 hours median  (0.1 days)

  Change Failure Rate  ● High
  4.8%  (2 failed / 42 total runs)

  ◈  Vulnerability Scan  (OSV.dev)
  ────────────────────────────────────────────────────────
  ✓ No known vulnerabilities found

  ◈  Suggestions
  ────────────────────────────────────────────────────────
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
| **Mean Time to Restore** | How fast you recover from a failed run | Workflow Runs API (failure → next success) |
| **Vulnerabilities** | Known CVEs in your dependencies | [OSV.dev](https://osv.dev) (free, no auth) |
| **Health Score** | Single 0–100 rollup of all DORA metrics | Weighted composite |
| **Suggestions** | Prioritized, actionable recommendations | Heuristic engine |

> Supports `package.json`, `requirements.txt`, and `go.mod` for vulnerability scanning.

---

## 🚀 Usage

### CLI (zero install)

```bash
# Any public repo — no token needed
npx delivery-intel facebook/react

# Compare last 30 days vs prior 30 days
npx delivery-intel vercel/next.js --trend

# Include burnout risk score
npx delivery-intel vercel/next.js --risk

# AI-powered executive narrative (requires LLM key — falls back to template)
npx delivery-intel vercel/next.js --narrative

# JSON output
npx delivery-intel vercel/next.js --json

# Save report to file
npx delivery-intel vercel/next.js --json --output report.json
```

### All flags

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON instead of the formatted terminal report |
| `--output <file>` | Write JSON to a file (can combine with `--json`) |
| `--trend` | Show 30-day vs prior-30-day deltas for all metrics |
| `--risk` | Include Burnout Risk Score (velocity + stability signal) |
| `--narrative` | Generate an executive summary (LLM or template fallback) |
| `--token <token>` | GitHub token — prefer `gh auth login` instead |
| `--no-spinner` | Disable the scanning animation (useful in CI logs) |
| `--version` | Print version |
| `--help` | Show help |

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

## 📦 JSON Output Schema

Pass `--json` (or `--json --output report.json`) to get machine-readable output.

```jsonc
{
  "repo": { "owner": "vercel", "repo": "next.js" },
  "fetchedAt": "2026-04-17T12:00:00.000Z",
  "overallScore": 87,                          // 0–100
  "doraMetrics": {
    "deploymentFrequency": {
      "deploymentsPerWeek": 12.4,
      "rating": "Elite",                       // Elite | High | Medium | Low
      "source": "merged_prs_fallback"          // deployments_api | merged_prs_fallback
    },
    "leadTimeForChanges": {
      "medianHours": 3.2,
      "rating": "Elite"
    },
    "changeFailureRate": {
      "percentage": 4.8,
      "failedRuns": 2,
      "totalRuns": 42,
      "rating": "High"
    }
  },
  "vulnerabilities": [
    {
      "packageName": "lodash",
      "currentVersion": "4.17.15",
      "vulnId": "GHSA-xxxx-xxxx-xxxx",
      "summary": "Prototype pollution",
      "severity": "high",                      // critical | high | medium | low
      "aliases": ["CVE-2021-23337"],
      "fixedVersion": "4.17.21"
    }
  ],
  "suggestions": [
    {
      "category": "reliability",               // performance | reliability | security
      "severity": "high",                      // high | medium | low
      "title": "High Pipeline Failure Rate",
      "description": "...",
      "actionItems": ["..."]
    }
  ],
  "dailyDeployments": [0, 1, 2, 3, 1, 2, 3], // last 7 days, index 0 = 6 days ago
  // present only with --trend
  "trend": {
    "windowDays": 30,
    "current":  { "deploymentsPerWeek": 12.4, "leadTimeHours": 3.2, "changeFailureRate": 4.8, "score": 87 },
    "prior":    { "deploymentsPerWeek": 9.1,  "leadTimeHours": 5.6, "changeFailureRate": 6.2, "score": 78 },
    "deltas":   { "deploymentsPerWeek": 3.3,  "leadTimeHours": -2.4, "changeFailureRate": -1.4, "score": 9 }
  },
  // present only with --risk
  "riskScore": {
    "score": 42,
    "level": "moderate",                       // low | moderate | high | critical
    "cycleTimeDelta": 0.12,
    "failureRateDelta": -0.05,
    "sentimentMultiplier": 1.0,
    "summary": "..."
  }
}
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

### GitHub Actions Marketplace action

The easiest way — use the action directly from the Marketplace:

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
      - uses: ParthibanRajasekaran/delivery-intel@main
        with:
          fail-below: '40'   # fail the job if score drops below 40
```

Outputs available after the step: `score`, `deploy-frequency`, `lead-time`, `change-failure-rate`, `mean-time-to-restore`.

### npx (custom pipeline)

```yaml
    steps:
      - name: Run delivery-intel
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx delivery-intel@latest ${{ github.repository }} --json --output report.json

      - name: Check health score
        run: |
          SCORE=$(jq '.overallScore' report.json)
          echo "Health score: $SCORE / 100"
          if (( $(echo "$SCORE < 40" | bc -l) )); then
            echo "::error::Score $SCORE is below threshold (40)"
            exit 1
          fi
```

> A ready-to-use workflow file with PR comments and artifact upload is included at [.github/workflows/delivery-intel.yml](.github/workflows/delivery-intel.yml).

---

## 🏅 Badge

Once you have the dashboard deployed, you can show a live delivery score in any README:

```markdown
[![Delivery Score](https://your-deployment-url/api/badge?repo=owner/repo)](https://github.com/ParthibanRajasekaran/delivery-intel)
```

The `GET /api/badge?repo=owner/repo` endpoint returns a [Shields.io endpoint-badge](https://shields.io/badges/endpoint-badge) payload. Score maps to color: `< 20` red → `< 40` orange → `< 60` yellow → `< 80` green → `≥ 80` bright green. Results cached 5 minutes.

> **Self-hosting**: deploy the dashboard (`npm run build && npm start` or `docker compose up dashboard`) and replace `your-deployment-url`.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      delivery-intel                          │
├──────────────┬───────────────┬───────────────────────────────┤
│   CLI        │   Dashboard   │   CI Workflow                 │
│  (npx)       │  (Next.js)    │   (.github/workflows/)        │
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
