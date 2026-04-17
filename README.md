<div align="center">

# delivery-intel

**Instant delivery health check for any GitHub repo.**

*Tell me, with evidence, whether this repo ships well, fails safely, and is getting better or worse.*

[![npm version](https://img.shields.io/npm/v/delivery-intel?color=cb3837&label=npm&logo=npm&logoColor=white)](https://www.npmjs.com/package/delivery-intel)
[![npm downloads](https://img.shields.io/npm/dw/delivery-intel?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/delivery-intel)
[![CI](https://img.shields.io/github/actions/workflow/status/ParthibanRajasekaran/delivery-intel/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white)](https://github.com/ParthibanRajasekaran/delivery-intel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node 18+](https://img.shields.io/badge/node-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)

</div>

> delivery-intel answers three questions — with evidence, not guesses:
> 1. **Does this repo ship well?** (deployment frequency, lead time)
> 2. **Does it fail safely?** (change fail rate, recovery time, vulnerabilities)
> 3. **Is it getting better or worse?** (30-day trend, score delta)
>
> Every metric shows its source, sample size, and confidence level. No fake precision.

---

## ⚡ Quick Start

```bash
# Verdict mode — grade, confidence, policy, evidence (new in v1.5)
npx delivery-intel facebook/react --v2

# Classic metrics dump
npx delivery-intel facebook/react
```

```
┌──────────────────────────────────────────────────────────────┐
│  facebook/react                                              │
│  Grade A-   Score 91/100   Confidence high                  │
│  Trend ↑ +4 pts                                             │
└──────────────────────────────────────────────────────────────┘

✓   NO POLICY VIOLATIONS
──────────────────────────────────────────────────────────────
  ✓ All delivery health policies are passing.

METRICS  (source · sample · confidence)
──────────────────────────────────────────────────────────────
  ◆ Deploy Frequency       12.4/wk  [high]  deployment_statuses
  ◆ Change Lead Time       3.2h     [high]  commit_to_deploy (84 PRs)
  ● Recovery Time          0.8h     [med]   deployment_failures
  ◆ Change Fail Rate       4.8%     [high]  deployment_statuses
  ● Pipeline Failures      8.2%     [high]  workflow_runs (52 runs)

SIGNAL QUALITY
──────────────────────────────────────────────────────────────
  ◈ Production signal strength: high
  ✓ Scanned manifests: npm (package.json), Go (go.mod)

SECURITY
──────────────────────────────────────────────────────────────
  ✓ No known vulnerabilities found in scanned manifests
```

> Works with full URLs too: `npx delivery-intel https://github.com/vercel/next.js --v2`

---

## Why DORA metrics matter

Google's [2024 DORA Report](https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report) (32,000+ respondents, 10 years of data):

| Metric | Elite teams | Low performers | Gap |
|--------|------------|----------------|-----|
| **Deploy Frequency** | On-demand (multiple/day) | < once per 6 months | **973×** |
| **Lead Time for Changes** | < 1 hour | 1 – 6 months | **6,570×** |
| **Change Failure Rate** | 0–15% | 46–60% | — |
| **Time to Restore** | < 1 hour | 1 week – 1 month | **6,570×** |

Elite teams are **2× more likely to meet reliability targets** and **1.8× more likely to meet business goals** (DORA 2024).

---

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

## What It Measures

| Metric | What it tells you | Source | Confidence |
|--------|-------------------|--------|------------|
| **Deploy Frequency** | How often code ships to production | Deployment statuses → deploys → Actions → PRs | Waterfall |
| **Change Lead Time** | Commit → production (PR flow as fallback) | Deployments + commits | High / Low |
| **Change Fail Rate** | % of deployments that failed or rolled back | Deployment statuses + heuristics | High / Low |
| **Recovery Time** | Time from failure to successful recovery | Deployment failures + workflow runs | High / Low |
| **Pipeline Failure Rate** | CI workflow run reliability (distinct from CFR) | Workflow Runs API | High |
| **Deployment Rework Rate** | Rollback/revert/hotfix rate (inferred) | PR titles + labels + deployment refs | Low (flagged) |
| **Vulnerabilities** | Known CVEs across 7 manifest ecosystems | [OSV.dev](https://osv.dev) batch API | — |
| **Delivery Score** | Confidence-weighted composite (0–100) | All of the above | Aggregate |

> Every metric exposes: data source · sample size · lookback window · confidence level.
> Low-confidence signals contribute less to the composite score — no fake precision.

Supported manifest ecosystems: **npm** · **pip** · **Go modules** · **Poetry** · **pnpm** · **Cargo** · **RubyGems**

---

## Usage

### CLI (zero install)

```bash
# Verdict: grade, confidence, policy violations, evidence chain (v2 engine)
npx delivery-intel facebook/react --v2

# Classic metrics output (v1 engine — backwards compatible)
npx delivery-intel facebook/react

# Compare last 30 days vs prior 30 days
npx delivery-intel vercel/next.js --trend

# Include workflow strain analysis
npx delivery-intel vercel/next.js --risk

# AI-powered executive narrative (requires LLM key — falls back to template)
npx delivery-intel vercel/next.js --narrative

# JSON output (v2 includes full evidence chain + policy result)
npx delivery-intel vercel/next.js --v2 --json

# Save report to file
npx delivery-intel vercel/next.js --v2 --json --output report.json
```

### All flags

| Flag | Description |
|------|-------------|
| `--v2` | **New** — evidence-driven engine with grade, confidence, and policy |
| `--pr-comment` | Write a PR guardrail comment to `delivery-intel-pr-comment.md` (use with `--v2`) |
| `--fail-below N` | Exit code 2 if delivery score is below N |
| `--block` | Enable blocking violations (use with `--v2 --fail-below`) |
| `--json` | Output raw JSON instead of the formatted terminal report |
| `--output <file>` | Write JSON to a file (can combine with `--json`) |
| `--trend` | Show 30-day vs prior-30-day deltas for all metrics |
| `--risk` | Include workflow strain analysis (velocity + stability signal) |
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

Paste a repo URL and get an animated dashboard with score ring, DORA cards, charts, vulnerability table, and suggestions.

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

## CI Integration

### GitHub Actions Marketplace action

The easiest way — use the action directly:

```yaml
# .github/workflows/delivery-intel.yml
name: Delivery Health Check

on:
  push:
    branches: [main]
  pull_request:

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: ParthibanRajasekaran/delivery-intel@v1.5.0
        with:
          fail-below: '40'   # fail the job if score drops below 40
```

Outputs available after the step: `score`, `deploy-frequency`, `lead-time`, `change-failure-rate`, `mean-time-to-restore`.

### Evidence-backed PR guardrail (v2 engine)

Posts a policy-aware comment on every PR — no block unless a real threshold is breached:

```yaml
    steps:
      - name: Delivery Health Check
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npx delivery-intel@latest ${{ github.repository }} \
            --v2 \
            --pr-comment \
            --fail-below 40 \
            --no-spinner

      - name: Post PR Comment
        if: always() && github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh pr comment ${{ github.event.pull_request.number }} \
            --body-file delivery-intel-pr-comment.md \
            --repo ${{ github.repository }}
```

The comment leads with a verdict (`✅ No block` / `⚠️ Warning` / `🚫 BLOCKED`), followed by a collapsible metrics table with source and confidence for every data point.

### npx (custom pipeline)

```yaml
    steps:
      - name: Run delivery-intel
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx delivery-intel@latest ${{ github.repository }} --v2 --json --output report.json

      - name: Check health score
        run: |
          SCORE=$(jq '.scores.delivery.score' report.json)
          echo "Health score: $SCORE / 100"
          if (( $(echo "$SCORE < 40" | bc -l) )); then
            echo "::error::Score $SCORE is below threshold (40)"
            exit 1
          fi
```

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
