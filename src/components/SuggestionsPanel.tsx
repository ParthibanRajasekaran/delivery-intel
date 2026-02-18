"use client";

import { motion } from "framer-motion";
import type { Suggestion } from "@/types";

interface SuggestionsPanelProps {
  suggestions: Suggestion[];
}

const categoryIcons: Record<string, string> = {
  performance: "⚡",
  reliability: "🛡️",
  security: "🔒",
};

const severityStyles: Record<string, { bg: string; border: string }> = {
  high: {
    bg: "rgba(239, 68, 68, 0.05)",
    border: "rgba(239, 68, 68, 0.2)",
  },
  medium: {
    bg: "rgba(234, 179, 8, 0.05)",
    border: "rgba(234, 179, 8, 0.2)",
  },
  low: {
    bg: "rgba(59, 130, 246, 0.05)",
    border: "rgba(59, 130, 246, 0.2)",
  },
};

const suggestionItem = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0 },
};

export function SuggestionsPanel({ suggestions }: SuggestionsPanelProps) {
  return (
    <motion.div
      className="rounded-xl p-6 glass-card"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      whileHover={{ borderColor: "var(--accent)" }}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <h3 className="text-sm font-semibold mb-1">Improvement Suggestions</h3>
      <p className="text-xs mb-5" style={{ color: "var(--text-muted)" }}>
        Heuristic-based recommendations from your metrics and scan results
      </p>

      <motion.div
        className="space-y-4"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.1, delayChildren: 0.3 } } }}
      >
        {suggestions.map((s, i) => (
          <motion.div
            key={i}
            className="rounded-lg p-4 suggestion-card"
            variants={suggestionItem}
            transition={{ duration: 0.4, ease: "easeOut" }}
            whileHover={{
              scale: 1.02,
              transition: { duration: 0.15 },
            }}
            style={{
              background: severityStyles[s.severity].bg,
              border: `1px solid ${severityStyles[s.severity].border}`,
            }}
          >
            <div className="flex items-start gap-2 mb-2">
              <span className="text-base">
                {categoryIcons[s.category] || "📌"}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold">{s.title}</h4>
                  <span
                    className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded"
                    style={{
                      color: "var(--text-muted)",
                      background: "var(--bg)",
                    }}
                  >
                    {s.severity}
                  </span>
                </div>
                <p
                  className="text-xs mt-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  {s.description}
                </p>
              </div>
            </div>
            <ul className="ml-7 space-y-1">
              {s.actionItems.map((item, j) => (
                <li
                  key={j}
                  className="text-xs flex items-start gap-1.5"
                  style={{ color: "var(--text)" }}
                >
                  <span style={{ color: "var(--accent)" }}>→</span>
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
