// ============================================================================
// Scoring: Fix Pack Engine
// ============================================================================
// Generates structured, actionable fix packs — not generic advice paragraphs.
// Each fix pack includes:
//   - finding: what the engine observed
//   - whyItMatters: grounded business context
//   - confidence: how certain is the finding
//   - impactArea: what dimension this improves
//   - effort: low / medium / high
//   - artifacts: concrete files/snippets the team can copy and apply
//
// Rule philosophy (from the product ADR):
//   "Turn every finding into a fix the repo can actually apply."
//   "Generated recommendations must be deterministic by default."
//   "All user-visible claims must reference structured evidence."
// ============================================================================

import type { MetricSuite, MetricConfidence } from "../domain/metrics.js";
import type { DependencyVulnerability } from "../cli/analyzer.js";

// ---------------------------------------------------------------------------
// Fix artifact types
// ---------------------------------------------------------------------------

export type ArtifactType =
  | "github-actions-yaml"
  | "dependabot-config"
  | "codeowners"
  | "branch-protection-guide"
  | "pr-template"
  | "markdown"
  | "rollback-workflow";

export interface FixArtifact {
  type: ArtifactType;
  filename: string;
  description: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Fix pack
// ---------------------------------------------------------------------------

export type ImpactArea =
  | "trustworthiness"
  | "velocity"
  | "stability"
  | "security"
  | "visibility"
  | "recovery";

export type EffortLevel = "low" | "medium" | "high";

export interface FixPack {
  /** Stable machine-readable ID. */
  id: string;
  /** One-line finding summary. */
  finding: string;
  /** Business context for why this matters. */
  whyItMatters: string;
  confidence: MetricConfidence;
  impactArea: ImpactArea;
  effort: EffortLevel;
  artifacts: FixArtifact[];
  /** Estimated trust score improvement (0-100 points) if this fix is applied. */
  trustGain: number;
  /** One-line explanation of how the trust score would improve. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Artifact templates
// ---------------------------------------------------------------------------

const DEPLOYMENT_EVENT_YAML = `# Add to your existing deploy workflow to emit GitHub deployment events.
# This enables delivery-intel to measure deployment frequency and recovery
# time directly from the GitHub Deployments API instead of approximating
# from merged PRs.
#
# See: https://docs.github.com/en/rest/deployments/deployments

name: Deploy with tracking

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # 1. Create a deployment record
      - name: Create GitHub Deployment
        id: deployment
        uses: actions/github-script@v7
        with:
          script: |
            const d = await github.rest.repos.createDeployment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              ref: context.sha,
              environment: 'production',
              auto_merge: false,
              required_contexts: [],
              description: 'Triggered by push to main',
            });
            return d.data.id;
          result-encoding: string

      # 2. Your actual deploy step goes here
      - name: Deploy
        run: echo "Run your deploy command here"

      # 3. Mark deployment as successful
      - name: Mark Deployment Success
        if: success()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.repos.createDeploymentStatus({
              owner: context.repo.owner,
              repo: context.repo.repo,
              deployment_id: \${{ steps.deployment.outputs.result }},
              state: 'success',
              environment: 'production',
              description: 'Deploy succeeded',
            });

      # 4. Mark deployment as failed on error
      - name: Mark Deployment Failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.repos.createDeploymentStatus({
              owner: context.repo.owner,
              repo: context.repo.repo,
              deployment_id: \${{ steps.deployment.outputs.result }},
              state: 'failure',
              environment: 'production',
              description: 'Deploy failed',
            });
`;

const DEPENDABOT_CONFIG = `# .github/dependabot.yml
# Dependabot automatically opens PRs to keep your dependencies up to date.
# This is the fastest way to resolve known vulnerabilities.
# See: https://docs.github.com/en/code-security/dependabot

version: 2
updates:
  # Adjust 'package-ecosystem' to match your project (npm, pip, gomod, cargo, etc.)
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
    commit-message:
      prefix: "chore"
      include: "scope"
`;

function branchProtectionGuide(defaultBranch = "main"): string {
  return `# Branch Protection Setup

Enable these rules on your \`${defaultBranch}\` branch to reduce pipeline failures
and enforce code quality gates:

## Via GitHub Settings → Branches → Add Rule

| Setting | Recommended value | Why |
|---------|------------------|-----|
| Require a pull request before merging | ✅ Enabled | Prevents direct pushes |
| Required approving reviews | 1 (min) | Catches mistakes early |
| Dismiss stale reviews on new push | ✅ Enabled | Reviews stay current |
| Require status checks to pass | ✅ Enabled | Blocks broken merges |
| Require branches to be up to date | ✅ Enabled | Prevents stale merges |
| Restrict pushes to matching branches | ✅ Enabled | Protects default branch |

## Via GitHub CLI (faster)

\`\`\`bash
gh api repos/{owner}/{repo}/branches/${defaultBranch}/protection \\
  --method PUT \\
  --field required_status_checks='{"strict":true,"contexts":[]}' \\
  --field enforce_admins=false \\
  --field required_pull_request_reviews='{"required_approving_review_count":1}' \\
  --field restrictions=null
\`\`\`
`;
}

const PR_TEMPLATE = `<!-- .github/pull_request_template.md -->
## What changed and why

<!-- Describe the change and the motivation. Link to the issue if applicable. -->

Fixes #

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Refactoring / no behaviour change
- [ ] Documentation only

## Checklist

- [ ] Tests added or updated
- [ ] Docs updated if needed
- [ ] This PR is small enough to review in < 30 minutes
- [ ] I have tested this locally or in a staging environment
- [ ] Linked issues are updated

## Deployment notes

<!-- Anything the reviewer or on-call should know before or after merging? -->
`;

const ROLLBACK_WORKFLOW_YAML = `# .github/workflows/rollback.yml
# One-click rollback workflow. Trigger manually with a target deployment ID
# or SHA to restore a previous production state.

name: Rollback Production

on:
  workflow_dispatch:
    inputs:
      target_sha:
        description: 'Git SHA to roll back to (leave blank to use previous successful deployment)'
        required: false
      reason:
        description: 'Reason for rollback (for audit log)'
        required: true

jobs:
  rollback:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Checkout target SHA
        uses: actions/checkout@v4
        with:
          ref: \${{ inputs.target_sha || github.event.repository.default_branch }}

      # Replace with your actual deploy command
      - name: Deploy rollback build
        run: |
          echo "Deploying rollback to production..."
          echo "Reason: \${{ inputs.reason }}"
          # Your deploy command here

      - name: Create GitHub Deployment for rollback
        uses: actions/github-script@v7
        with:
          script: |
            const d = await github.rest.repos.createDeployment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              ref: '\${{ inputs.target_sha }}' || context.sha,
              environment: 'production',
              auto_merge: false,
              required_contexts: [],
              description: 'ROLLBACK: \${{ inputs.reason }}',
            });
            await github.rest.repos.createDeploymentStatus({
              owner: context.repo.owner,
              repo: context.repo.repo,
              deployment_id: d.data.id,
              state: 'success',
              description: 'Rollback deployed',
            });
`;

// ---------------------------------------------------------------------------
// Fix pack generators
// ---------------------------------------------------------------------------

function fixMissingDeploymentTracking(): FixPack {
  return {
    id: "missing-deployment-tracking",
    finding:
      "Deployment frequency is approximated from merged PRs — no GitHub deployment events found.",
    whyItMatters:
      "Without deployment events, DORA metrics (frequency, lead time, change fail rate, recovery time) " +
      "are inferred proxies, not measurements. This inflates confidence in the output and makes " +
      "trend detection unreliable. Deployment events cost minutes to add.",
    confidence: "high",
    impactArea: "trustworthiness",
    effort: "low",
    artifacts: [
      {
        type: "github-actions-yaml",
        filename: ".github/workflows/deploy-with-tracking.yml",
        description:
          "Add to your deploy workflow to emit GitHub deployment events. " +
          "Enables direct measurement of frequency, lead time, CFR, and recovery time.",
        content: DEPLOYMENT_EVENT_YAML,
      },
    ],
    trustGain: 12,
    rationale:
      "Moves all DORA metrics from inferred to measured, raising confidence across every trust dimension",
  };
}

function fixHighPipelineFailureRate(percentage: number, failed: number, total: number): FixPack {
  return {
    id: "high-pipeline-failure-rate",
    finding: `${percentage}% of CI workflow runs failed (${failed}/${total} runs).`,
    whyItMatters:
      "A high pipeline failure rate slows every engineer on the team — broken CI means blocked merges, " +
      "noisy notifications, and eroded trust in the safety net. It also inflates apparent change fail rate " +
      "when no production deployment data is available.",
    confidence: total >= 20 ? "high" : "medium",
    impactArea: "stability",
    effort: "medium",
    artifacts: [
      {
        type: "branch-protection-guide",
        filename: "docs/branch-protection-setup.md",
        description: "Enforce required status checks so broken pipelines cannot merge to main.",
        content: branchProtectionGuide(),
      },
      {
        type: "github-actions-yaml",
        filename: ".github/workflows/ci-matrix.yml",
        description: "Add test retries and matrix isolation to reduce flaky test failures.",
        content: `# Add these options to your CI workflow to reduce false failures from flaky tests.

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false           # don't cancel sibling jobs on first failure
      matrix:
        node-version: [18, 20]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm test
        # Retry flaky tests once before failing
        continue-on-error: false
`,
      },
    ],
    trustGain: 8,
    rationale: `Reducing pipeline failure rate from ${percentage}% improves CI reliability trust dimension`,
  };
}

function fixHighChangeFailRate(percentage: number): FixPack {
  return {
    id: "high-change-fail-rate",
    finding: `${percentage}% of deployments required rollback or hotfix intervention.`,
    whyItMatters:
      "Change Fail Rate is one of DORA's four core metrics. Elite teams achieve 0–15%. " +
      "High CFR means production incidents are frequent, eroding team confidence and user trust. " +
      "The root cause is usually insufficient pre-production validation.",
    confidence: "medium",
    impactArea: "stability",
    effort: "medium",
    artifacts: [
      {
        type: "rollback-workflow",
        filename: ".github/workflows/rollback.yml",
        description:
          "Manual one-click rollback workflow. Reduces recovery time and emits deployment events " +
          "so recovery time can be measured accurately.",
        content: ROLLBACK_WORKFLOW_YAML,
      } as FixArtifact,
      {
        type: "pr-template",
        filename: ".github/pull_request_template.md",
        description: "PR checklist to encourage staging validation and smaller change batches.",
        content: PR_TEMPLATE,
      },
    ],
    trustGain: 10,
    rationale: `Reducing ${percentage}% change fail rate directly improves change safety trust dimension`,
  };
}

function fixSlowLeadTime(medianHours: number, signal: string): FixPack {
  const days = (medianHours / 24).toFixed(1);
  return {
    id: "slow-lead-time",
    finding: `Median lead time is ${medianHours}h (${days} days) via ${signal}. Elite benchmark: < 24h.`,
    whyItMatters:
      "Long lead time is a compounding tax. Each day a change waits in review or queue increases " +
      "merge conflict probability and context-switch cost. Teams with < 24h lead time ship 2× more " +
      "frequently than those above 1 week (DORA 2024).",
    confidence: "medium",
    impactArea: "velocity",
    effort: "low",
    artifacts: [
      {
        type: "codeowners",
        filename: ".github/CODEOWNERS",
        description:
          "Auto-assign reviewers by path. Eliminates the manual 'who should review this?' delay.",
        content: `# .github/CODEOWNERS
# Automatic reviewer assignment — no more waiting for someone to self-assign.
# See: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners

# Default: assign all PRs to the core team
*       @your-org/core-team

# Frontend
/src/components/   @your-org/frontend-team
/src/app/          @your-org/frontend-team

# Infrastructure / CI
/.github/          @your-org/platform-team
/Dockerfile        @your-org/platform-team

# Security-sensitive paths — require security team review
/src/security/     @your-org/security-team
`,
      },
      {
        type: "pr-template",
        filename: ".github/pull_request_template.md",
        description: "PR template with size checklist. Smaller PRs review faster.",
        content: PR_TEMPLATE,
      },
    ],
    trustGain: 5,
    rationale: `Cutting lead time from ${days} days improves review latency and velocity perception`,
  };
}

function fixMissingDependabot(ecosystem = "npm"): FixPack {
  return {
    id: "missing-dependabot",
    finding: "Vulnerability scan found known CVEs. No Dependabot config detected.",
    whyItMatters:
      "Known vulnerabilities with available fixes are the lowest-effort security improvement available. " +
      "Dependabot opens PRs automatically — the fix cost is a review and merge, not research.",
    confidence: "high",
    impactArea: "security",
    effort: "low",
    artifacts: [
      {
        type: "dependabot-config",
        filename: ".github/dependabot.yml",
        description: `Dependabot config for ${ecosystem}. Automatically PRs dependency updates weekly.`,
        content: DEPENDABOT_CONFIG,
      },
    ],
    trustGain: 15,
    rationale:
      "Automated dependency updates address known CVEs, directly improving vulnerability exposure dimension",
  };
}

function fixSlowRecovery(medianHours: number): FixPack {
  return {
    id: "slow-recovery-time",
    finding: `Median failed deployment recovery time is ${medianHours}h. DORA Elite: < 1h.`,
    whyItMatters:
      "Long recovery time means production incidents have extended blast radius. " +
      "The primary lever is a tested, one-click rollback path — not faster debugging.",
    confidence: "medium",
    impactArea: "recovery",
    effort: "low",
    artifacts: [
      {
        type: "github-actions-yaml",
        filename: ".github/workflows/rollback.yml",
        description:
          "One-click rollback workflow. Manually dispatchable from the Actions tab or gh CLI.",
        content: ROLLBACK_WORKFLOW_YAML,
      },
    ],
    trustGain: 7,
    rationale: `Cutting recovery from ${medianHours}h to <1h improves change safety and CI reliability dimensions`,
  };
}

// ---------------------------------------------------------------------------
// Public: generate all applicable fix packs
// ---------------------------------------------------------------------------

export function generateFixPacks(
  metrics: MetricSuite,
  vulns: DependencyVulnerability[],
): FixPack[] {
  const packs: FixPack[] = [];

  // Deployment tracking
  const df = metrics.deploymentFrequency;
  if (df.isInferred || df.confidence === "low") {
    packs.push(fixMissingDeploymentTracking());
  }

  // Pipeline failure rate
  const pfr = metrics.pipelineFailureRate.value;
  if (pfr && pfr.percentage > 20) {
    packs.push(fixHighPipelineFailureRate(pfr.percentage, pfr.failedRuns, pfr.totalRuns));
  }

  // Change fail rate
  const cfr = metrics.changeFailRate.value;
  if (cfr && cfr.percentage > 15) {
    packs.push(fixHighChangeFailRate(cfr.percentage));
  }

  // Lead time
  const lt = metrics.changeLeadTime.value;
  if (lt) {
    const hours =
      lt.primarySignal === "commit_to_deploy" ? lt.commitToDeployMedianHours : lt.prFlowMedianHours;
    const signal =
      lt.primarySignal === "commit_to_deploy"
        ? "commit-to-deploy"
        : "PR open→merge (fallback — no deployment data)";
    if (hours !== null && hours > 168) {
      packs.push(fixSlowLeadTime(hours, signal));
    }
  }

  // Recovery time
  const fdrt = metrics.failedDeploymentRecoveryTime.value;
  if (fdrt && fdrt.medianHours > 24) {
    packs.push(fixSlowRecovery(fdrt.medianHours));
  }

  // Vulnerabilities
  const hasCritical = vulns.some((v) => v.severity === "critical");
  const hasHigh = vulns.some((v) => v.severity === "high");
  if (hasCritical || hasHigh) {
    packs.push(fixMissingDependabot());
  }

  return packs;
}
