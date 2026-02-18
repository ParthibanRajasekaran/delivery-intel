"use client";

import { motion } from "framer-motion";
import type { GitHubCommit } from "@/types";

interface CommitListProps {
  commits: GitHubCommit[];
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const commitItem = {
  hidden: { opacity: 0, x: 16 },
  show: { opacity: 1, x: 0 },
};

export function CommitList({ commits }: CommitListProps) {
  return (
    <motion.div
      className="rounded-xl p-6 glass-card"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      whileHover={{ borderColor: "var(--accent)" }}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <h3 className="text-sm font-semibold mb-1">Recent Commits</h3>
      <p className="text-xs mb-5" style={{ color: "var(--text-muted)" }}>
        Latest activity on the default branch
      </p>

      <motion.div
        className="space-y-3"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.4 } } }}
      >
        {commits.map((c) => (
          <motion.div
            key={c.sha}
            className="flex items-start gap-3 p-3 rounded-lg commit-row"
            variants={commitItem}
            transition={{ duration: 0.35 }}
            whileHover={{
              x: 4,
              background: "var(--surface-hover)",
              transition: { duration: 0.15 },
            }}
            style={{ background: "var(--bg)" }}
          >
            {c.author?.avatar_url ? (
              <img
                src={c.author.avatar_url}
                alt={c.author.login}
                width={28}
                height={28}
                className="rounded-full mt-0.5"
              />
            ) : (
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                style={{
                  background: "var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                {(c.commit.author.name || "?")[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">
                {c.commit.message.split("\n")[0]}
              </p>
              <div
                className="flex items-center gap-2 mt-1 text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                <span>{c.author?.login || c.commit.author.name}</span>
                <span>·</span>
                <span className="font-mono">{c.sha.slice(0, 7)}</span>
                <span>·</span>
                <span>{timeAgo(c.commit.author.date)}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
