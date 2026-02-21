import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock framer-motion so tests don't depend on animation timing
// ---------------------------------------------------------------------------
vi.mock("framer-motion", () => {
  const actual = { __esModule: true };
  const FRAMER_PROPS = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "whileHover",
    "whileTap",
    "whileInView",
  ]);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const motionHandler = {
    get(_target: unknown, prop: string) {
      return ({ children, ...rest }: { children?: React.ReactNode; [k: string]: unknown }) => {
        const domProps = Object.fromEntries(
          Object.entries(rest).filter(([k]) => !FRAMER_PROPS.has(k)),
        );
        return React.createElement(prop, domProps, children);
      };
    },
  };

  return {
    ...actual,
    motion: new Proxy({}, motionHandler),
    useInView: () => true,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { ScoreRing } from "@/components/ScoreRing";
import { DORACards } from "@/components/DORACards";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import type { DORAMetrics, Suggestion } from "@/types";

// ---------------------------------------------------------------------------
// ScoreRing
// ---------------------------------------------------------------------------

describe("ScoreRing", () => {
  it("renders the score ring SVG", () => {
    const { container } = render(<ScoreRing score={85} />);

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    // Should render at least the track and progress circles
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(2);
  });

  it("renders / 100 label", () => {
    render(<ScoreRing score={42} />);
    expect(screen.getByText("/ 100")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// DORACards
// ---------------------------------------------------------------------------

const sampleMetrics: DORAMetrics = {
  deploymentFrequency: {
    deploymentsPerWeek: 5,
    rating: "Elite",
    source: "deployments_api",
  },
  leadTimeForChanges: {
    medianHours: 4.2,
    rating: "Elite",
  },
  changeFailureRate: {
    percentage: 3,
    failedRuns: 1,
    totalRuns: 30,
    rating: "Elite",
  },
  meanTimeToRestore: {
    medianHours: null,
    rating: "N/A",
  },
};

describe("DORACards", () => {
  it("renders all three metric cards", () => {
    render(<DORACards metrics={sampleMetrics} />);

    expect(screen.getByText("Deploy Frequency")).toBeTruthy();
    expect(screen.getByText("Lead Time")).toBeTruthy();
    expect(screen.getByText("Change Failure Rate")).toBeTruthy();
  });

  it("renders the Elite rating badge", () => {
    render(<DORACards metrics={sampleMetrics} />);
    const eliteBadges = screen.getAllByText("Elite");
    expect(eliteBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("renders N/A rating when applicable", () => {
    // Use the sample metrics which already have N/A for meanTimeToRestore
    // Instead test CFR with N/A
    const naMetrics: DORAMetrics = {
      ...sampleMetrics,
      leadTimeForChanges: {
        medianHours: 0,
        rating: "N/A" as DORAMetrics["leadTimeForChanges"]["rating"],
      },
    };
    render(<DORACards metrics={naMetrics} />);
    expect(screen.getByText("N/A")).toBeTruthy();
  });

  it("renders deployment frequency value", () => {
    render(<DORACards metrics={sampleMetrics} />);
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("/ week")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SuggestionsPanel
// ---------------------------------------------------------------------------

const sampleSuggestions: Suggestion[] = [
  {
    title: "Add branch protection",
    description: "Require PR reviews before merging.",
    category: "security",
    severity: "high",
    actionItems: ["Enable branch protection rules", "Require at least 1 review"],
  },
  {
    title: "Reduce lead time",
    description: "Consider smaller PRs for faster reviews.",
    category: "performance",
    severity: "medium",
    actionItems: ["Break large PRs into smaller ones"],
  },
];

describe("SuggestionsPanel", () => {
  it("renders the heading", () => {
    render(<SuggestionsPanel suggestions={sampleSuggestions} />);
    expect(screen.getByText("Improvement Suggestions")).toBeTruthy();
  });

  it("renders all suggestions", () => {
    render(<SuggestionsPanel suggestions={sampleSuggestions} />);
    expect(screen.getByText("Add branch protection")).toBeTruthy();
    expect(screen.getByText("Reduce lead time")).toBeTruthy();
  });

  it("renders suggestion severity badges", () => {
    render(<SuggestionsPanel suggestions={sampleSuggestions} />);
    expect(screen.getByText("high")).toBeTruthy();
    expect(screen.getByText("medium")).toBeTruthy();
  });

  it("renders action items", () => {
    render(<SuggestionsPanel suggestions={sampleSuggestions} />);
    expect(screen.getByText("Enable branch protection rules")).toBeTruthy();
    expect(screen.getByText("Require at least 1 review")).toBeTruthy();
  });

  it("renders empty state gracefully", () => {
    const { container } = render(<SuggestionsPanel suggestions={[]} />);
    expect(container.textContent).toContain("Improvement Suggestions");
  });
});
