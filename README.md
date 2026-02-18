# delivery-intel

I kept running into the same problem at work: someone would ask "how's our delivery pipeline doing?" and nobody had a straight answer. We'd dig through GitHub Actions logs, count PRs by hand, maybe check Dependabot if someone remembered. It was always a pain.

So I built this. Point it at any public GitHub repo and it'll tell you how things are going — deployment frequency, lead times, failure rates, known vulnerabilities — and roll it all up into a single health score. No admin access required, no complex setup, no YAML to configure. Just run it.

## What it actually does

**DORA metrics** — the ones that actually matter for measuring delivery performance:

- **Deployment Frequency** — How often code reaches production. Pulls from the GitHub Deployments API, and if a repo doesn't use formal deployments (most don't), it falls back to counting merged PRs against the default branch.
- **Lead Time for Changes** — Time from PR creation to merge. This is the practical definition — not the theoretical "commit to production" that nobody can actually measure without custom instrumentation.
- **Change Failure Rate** — What percentage of CI pipeline runs are failing, along with raw counts (e.g. 3 failed out of 20 total). Helpful for spotting reliability trends.

**Vulnerability scanning** — Parses `package.json`, `requirements.txt`, and `go.mod` from the repo, then checks each dependency against the [OSV.dev](https://osv.dev) database. Free API, no auth needed, covers CVEs across ecosystems.

**Health score** — A single 0–100 number that rolls up all three DORA metrics and applies penalties for known vulnerabilities. Not perfect, but gives you something to track over time.

**Suggestions** — Based on what the metrics look like, it'll generate concrete recommendations (e.g., "Add a CI pipeline", "Reduce PR review cycle time", "Update vulnerable dependencies"). Prioritized by severity.

## Quick start

The fastest way to try it:

```bash
npx delivery-intel facebook/react
```

That's it. Works on any public repo, no token needed. You'll get a terminal report with scores, metrics, vulnerabilities, and suggestions.

You can also pass full URLs:

```bash
npx delivery-intel https://github.com/vercel/next.js
```

### Options

```
npx delivery-intel <owner/repo> [options]

  --json              Output raw JSON instead of the formatted report
  --output <file>     Write JSON output to a file (implies --json)
  --token <token>     GitHub personal access token (not recommended — see below)
  --help              Show help
```

### Authentication

For public repos, you don't need any auth at all. GitHub gives you 60 API requests/hour without a token, which is enough for a quick analysis.

If you hit rate limits or want to analyze private repos, the easiest way is through the GitHub CLI:

```bash
# Install it if you haven't
brew install gh

# Login (token stays in your OS keychain, never written to disk)
gh auth login
```

delivery-intel will automatically pick up the token from `gh auth`. You can also set `GITHUB_TOKEN` as an environment variable if you prefer.

Token resolution order:
1. `--token` flag (explicit, works but be careful in CI)
2. `GITHUB_TOKEN` env var
3. `gh auth token` (recommended — keychain-backed)

## Using the dashboard

There's also a web dashboard if you want something more visual. It runs locally:

```bash
git clone https://github.com/ParthibanRajasekaran/delivery-intel.git
cd delivery-intel
npm install
npm run dev
```

Open `http://localhost:3000`, paste a repo URL, and you'll get an animated dashboard with charts, a score ring, DORA cards, vulnerability tables, and suggestions — all rendered in a dark theme.

If you want caching (saves API calls on repeated lookups), run Redis alongside:

```bash
brew install redis && redis-server
```

The app auto-connects to Redis on localhost. If it's not running, everything still works — just no caching.

## Using in CI

You can add delivery-intel to your GitHub Actions pipeline. Here's an example that runs on every PR and fails the build if the health score drops below 40:

```yaml
- name: Run delivery-intel
  run: npx delivery-intel ${{ github.repository }} --json --output report.json
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Check health score
  run: |
    SCORE=$(jq '.score' report.json)
    echo "Health score: $SCORE"
    if (( $(echo "$SCORE < 40" | bc -l) )); then
      echo "Score below threshold"
      exit 1
    fi
```

## Docker

If containers are more your thing:

```bash
# Dashboard mode
docker compose up dashboard

# CLI mode
REPO=facebook/react docker compose run --rm cli
```

## How it works under the hood

The CLI and the dashboard share the same analysis engine. It makes a handful of GitHub REST API calls (commits, workflow runs, deployments, pull requests, file contents), queries OSV.dev for vulnerability data, computes the three DORA metrics, generates suggestions, and calculates the overall score. The whole thing usually finishes in a few seconds.

The dashboard wraps this in a Next.js API route with optional Redis caching. The frontend is React with Recharts for the charts and Framer Motion for animations.

## Tech stack

- TypeScript, Next.js (App Router)
- `@octokit/rest` and `@octokit/graphql` for GitHub
- Recharts for visualization
- Framer Motion for UI animations
- ioredis for caching
- OSV.dev for vulnerability data
- Tailwind CSS for styling

## License

MIT
