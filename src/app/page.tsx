"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Variants } from "framer-motion";
import type { RepoAnalysis } from "@/types";
import { ScoreRing } from "@/components/ScoreRing";
import { DORACards } from "@/components/DORACards";
import { FailureRateChart } from "@/components/FailureRateChart";
import { VulnerabilityTable } from "@/components/VulnerabilityTable";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { CommitList } from "@/components/CommitList";

/* ── Stagger container helper ── */
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
};

/* ── Skeleton loader ── */
function AnalysisSkeleton() {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-16">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        <div className="lg:col-span-1 skeleton-card h-52" />
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="skeleton-card h-40"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="skeleton-card h-64" style={{ animationDelay: "0.3s" }} />
        <div className="skeleton-card h-64" style={{ animationDelay: "0.45s" }} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 skeleton-card h-48" style={{ animationDelay: "0.6s" }} />
        <div className="lg:col-span-1 skeleton-card h-48" style={{ animationDelay: "0.75s" }} />
      </div>
    </section>
  );
}

export default function HomePage() {
  const [repoInput, setRepoInput] = useState("");
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (!repoInput.trim()) {
      return;
    }

    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
      } else {
        setAnalysis(data as RepoAnalysis);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="ambient-glow" />

      {/* Header */}
      <motion.header
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          position: "relative",
          zIndex: 10,
        }}
      >
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ rotate: 12, scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 16,
                cursor: "pointer",
              }}
            >
              DI
            </motion.div>
            <h1 className="text-lg font-semibold">Delivery Intel</h1>
          </div>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Software Delivery Intelligence
          </span>
        </div>
      </motion.header>

      {/* Search */}
      <section className="mx-auto max-w-7xl px-6 py-10 relative z-10">
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <h2 className="text-3xl font-bold mb-2 hero-gradient-text">Analyze Any Repository</h2>
          <p style={{ color: "var(--text-muted)" }}>
            Enter a GitHub repository URL or slug to get DORA metrics, vulnerability scanning, and
            actionable insights.
          </p>
        </motion.div>

        <motion.form
          onSubmit={handleAnalyze}
          className="flex gap-3 max-w-2xl mx-auto"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="e.g. vercel/next.js or https://github.com/facebook/react"
            disabled={loading}
            className="flex-1 px-4 py-3 rounded-lg text-sm outline-none search-input"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
          <motion.button
            type="submit"
            disabled={loading || !repoInput.trim()}
            className="px-6 py-3 rounded-lg font-medium text-sm"
            whileHover={{ scale: 1.04, boxShadow: "0 0 24px rgba(99, 102, 241, 0.4)" }}
            whileTap={{ scale: 0.97 }}
            style={{
              background: loading ? "var(--border)" : "var(--accent)",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="spinner" />
                Analyzing…
              </span>
            ) : (
              "Analyze"
            )}
          </motion.button>
        </motion.form>

        <AnimatePresence>
          {error && (
            <motion.div
              className="max-w-2xl mx-auto mt-4 px-4 py-3 rounded-lg text-sm"
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              style={{
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "var(--danger)",
              }}
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Loading skeleton */}
      <AnimatePresence>
        {loading && (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <AnalysisSkeleton />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <AnimatePresence>
        {analysis && (
          <motion.section
            key="results"
            className="mx-auto max-w-7xl px-6 pb-16 relative z-10"
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {/* Top row: Score + DORA cards */}
            <motion.div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8" variants={fadeUp}>
              <motion.div
                className="lg:col-span-1 rounded-xl p-6 flex flex-col items-center justify-center glass-card"
                whileHover={{ scale: 1.02, borderColor: "var(--accent)" }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <ScoreRing score={analysis.overallScore} />
                <p className="mt-3 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Overall Health Score
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {analysis.repo.owner}/{analysis.repo.repo}
                </p>
              </motion.div>
              <div className="lg:col-span-3">
                <DORACards metrics={analysis.doraMetrics} />
              </div>
            </motion.div>

            {/* Middle row: Chart + Vulnerabilities */}
            <motion.div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8" variants={fadeUp}>
              <FailureRateChart metrics={analysis.doraMetrics} />
              <VulnerabilityTable vulnerabilities={analysis.vulnerabilities} />
            </motion.div>

            {/* Bottom row: Suggestions + Recent Commits */}
            <motion.div className="grid grid-cols-1 lg:grid-cols-3 gap-6" variants={fadeUp}>
              <div className="lg:col-span-2">
                <SuggestionsPanel suggestions={analysis.suggestions} />
              </div>
              <div className="lg:col-span-1">
                <CommitList commits={analysis.recentCommits} />
              </div>
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Empty state */}
      <AnimatePresence>
        {!analysis && !loading && !error && (
          <motion.section
            key="empty"
            className="mx-auto max-w-7xl px-6 pb-16 text-center relative z-10"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <div
              className="rounded-xl p-12 glass-card"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="text-4xl mb-4"
              >
                🔍
              </motion.div>
              <p className="text-lg font-medium mb-2" style={{ color: "var(--text-muted)" }}>
                No repository analyzed yet
              </p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Enter a GitHub repository above to get started. We&apos;ll compute DORA metrics,
                scan for vulnerabilities, and provide improvement suggestions.
              </p>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}
