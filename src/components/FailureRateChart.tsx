"use client";

import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import type { DORAMetrics } from "@/types";

interface FailureRateChartProps {
  metrics: DORAMetrics;
}

export function FailureRateChart({ metrics }: FailureRateChartProps) {
  const rate = metrics.changeFailureRate.percentage;
  const successRate = +(100 - rate).toFixed(1);

  const data = [
    { name: "Successful", value: successRate, color: "#22c55e" },
    { name: "Failed", value: rate, color: "#ef4444" },
  ];

  const doraData = [
    { name: "Deploy Freq", value: metrics.deploymentFrequency.deploymentsPerWeek, max: 14 },
    { name: "Lead Time (h)", value: Math.min(metrics.leadTimeForChanges.medianHours, 336), max: 336 },
    { name: "Failure %", value: metrics.changeFailureRate.percentage, max: 100 },
  ];

  return (
    <motion.div
      className="rounded-xl p-6 glass-card"
      initial={{ opacity: 0, x: -40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ borderColor: "var(--accent)" }}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <h3 className="text-sm font-semibold mb-1">Pipeline Health</h3>
      <p className="text-xs mb-6" style={{ color: "var(--text-muted)" }}>
        CI/CD success vs. failure rate from recent workflow runs
      </p>

      <div className="grid grid-cols-2 gap-6">
        {/* Donut-style bar chart */}
        <div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} layout="vertical" barSize={28}>
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis type="category" dataKey="name" width={80} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value) => `${value}%`}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {data.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* DORA metrics overview bar */}
        <div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={doraData} barSize={20}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </motion.div>
  );
}
