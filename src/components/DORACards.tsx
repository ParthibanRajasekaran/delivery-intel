"use client";

import { motion } from "framer-motion";
import type { DORAMetrics } from "@/types";

interface DORACardsProps {
  metrics: DORAMetrics;
}

const ratingColors: Record<string, string> = {
  Elite: "var(--success)",
  High: "var(--info)",
  Medium: "var(--warning)",
  Low: "var(--danger)",
  "N/A": "var(--text-muted)",
};

const cardVariants = {
  hidden: { opacity: 0, y: 28, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1 },
};

function MetricCard({
  title,
  value,
  unit,
  rating,
  description,
  subtitle,
  index,
}: {
  title: string;
  value: string | number;
  unit: string;
  rating: string;
  description: string;
  subtitle?: string;
  index: number;
}) {
  return (
    <motion.div
      className="rounded-xl p-5 glass-card"
      variants={cardVariants}
      transition={{
        duration: 0.5,
        delay: index * 0.12,
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={{
        scale: 1.03,
        borderColor: ratingColors[rating],
        boxShadow: `0 8px 32px ${ratingColors[rating]}20`,
        transition: { duration: 0.2 },
      }}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        cursor: "default",
      }}
    >
      <div className="flex items-start justify-between mb-1">
        <span
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {title}
        </span>
        <motion.span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.4 + index * 0.12, type: "spring", stiffness: 500, damping: 20 }}
          style={{
            color: ratingColors[rating],
            background: `${ratingColors[rating]}15`,
          }}
        >
          {rating}
        </motion.span>
      </div>
      <p
        className="text-[11px] mb-3 leading-relaxed"
        style={{ color: "var(--text-muted)" }}
      >
        {description}
      </p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold">{value}</span>
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>
          {unit}
        </span>
      </div>
      {subtitle && (
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          {subtitle}
        </p>
      )}
    </motion.div>
  );
}

export function DORACards({ metrics }: DORACardsProps) {
  return (
    <motion.div
      className="grid grid-cols-1 sm:grid-cols-3 gap-4"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.12 } } }}
    >
      <MetricCard
        index={0}
        title="Deploy Frequency"
        description="How often code is deployed to production. Higher frequency indicates a mature, automated delivery pipeline."
        value={metrics.deploymentFrequency.deploymentsPerWeek}
        unit="/ week"
        rating={metrics.deploymentFrequency.rating}
        subtitle={
          metrics.deploymentFrequency.source === "merged_prs_fallback"
            ? "Estimated from merged PRs"
            : "From GitHub Deployments API"
        }
      />
      <MetricCard
        index={1}
        title="Lead Time"
        description="How long a branch and its PR stayed active — from PR creation until it was merged. Shorter times mean faster review cycles."
        value={metrics.leadTimeForChanges.medianHours}
        unit="hours (median)"
        rating={metrics.leadTimeForChanges.rating}
      />
      <MetricCard
        index={2}
        title="Change Failure Rate"
        description={`Percentage of deployment pipeline runs that failed. ${metrics.changeFailureRate.failedRuns} of ${metrics.changeFailureRate.totalRuns} pipeline runs failed.`}
        value={metrics.changeFailureRate.percentage}
        unit="%"
        rating={metrics.changeFailureRate.rating}
        subtitle={`${metrics.changeFailureRate.failedRuns} failed / ${metrics.changeFailureRate.totalRuns} total pipeline runs`}
      />
    </motion.div>
  );
}
