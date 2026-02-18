// ============================================================================
// Software Delivery Intelligence — Type Definitions
// ============================================================================

/** Parsed owner/repo from a GitHub URL or slug */
export interface RepoIdentifier {
  owner: string;
  repo: string;
}

// ----- Raw GitHub Data Shapes -----

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string | null;
      date: string | null;
    };
  };
  author: { login: string; avatar_url: string } | null;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string | null;
  head_branch: string | null;
  status: string | null;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  html_url: string;
}

export interface GitHubDeployment {
  id: number;
  environment: string;
  created_at: string;
  updated_at: string;
  sha: string;
  ref: string;
  task: string;
  description: string | null;
  statuses_url: string;
}

export interface GitHubDeploymentStatus {
  id: number;
  state: string; // "success" | "failure" | "error" | "pending" | "in_progress"
  created_at: string;
  description: string | null;
  environment: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  merged_at: string | null;
  created_at: string;
  closed_at: string | null;
  user: { login: string; avatar_url: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
}

// ----- GraphQL Response Shapes -----

export interface GQLPullRequestNode {
  number: number;
  title: string;
  createdAt: string;
  mergedAt: string | null;
  state: string;
  headRefOid: string;
  baseRefName: string;
  author: { login: string; avatarUrl: string } | null;
  url: string;
  commits: {
    nodes: Array<{
      commit: {
        committedDate: string;
        deployments: {
          nodes: Array<{
            environment: string;
            createdAt: string;
            state: string;
            latestStatus: {
              state: string;
              createdAt: string;
            } | null;
          }>;
        };
      };
    }>;
  };
}

export interface GQLPullRequestsResponse {
  repository: {
    pullRequests: {
      nodes: GQLPullRequestNode[];
    };
    defaultBranchRef: {
      name: string;
    } | null;
  };
}

// ----- OSV.dev Vulnerability Shapes -----

export interface OSVVulnerability {
  id: string;
  summary: string;
  details: string;
  aliases: string[];
  severity: Array<{
    type: string;
    score: string;
  }>;
  affected: Array<{
    package: {
      name: string;
      ecosystem: string;
    };
    ranges: Array<{
      type: string;
      events: Array<{ introduced?: string; fixed?: string }>;
    }>;
  }>;
  references: Array<{ type: string; url: string }>;
}

export interface DependencyVulnerability {
  packageName: string;
  currentVersion: string;
  vulnId: string;
  summary: string;
  severity: string;
  aliases: string[];   // CVE IDs
  fixedVersion: string | null;
}

// ----- Computed Metrics -----

export interface DORAMetrics {
  deploymentFrequency: {
    deploymentsPerWeek: number;
    rating: "Elite" | "High" | "Medium" | "Low";
    source: "deployments_api" | "merged_prs_fallback";
  };
  leadTimeForChanges: {
    medianHours: number;
    rating: "Elite" | "High" | "Medium" | "Low";
  };
  changeFailureRate: {
    percentage: number;
    failedRuns: number;
    totalRuns: number;
    rating: "Elite" | "High" | "Medium" | "Low";
  };
  meanTimeToRestore: {
    medianHours: number | null;  // null if no failures found
    rating: "Elite" | "High" | "Medium" | "Low" | "N/A";
  };
}

export interface Suggestion {
  category: "performance" | "reliability" | "security";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  actionItems: string[];
}

export interface RepoAnalysis {
  repo: RepoIdentifier;
  fetchedAt: string;
  recentCommits: GitHubCommit[];
  doraMetrics: DORAMetrics;
  vulnerabilities: DependencyVulnerability[];
  suggestions: Suggestion[];
  overallScore: number;  // 0–100
}
