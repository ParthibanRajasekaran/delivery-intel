"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useInView } from "framer-motion";

interface ScoreRingProps {
  score: number;
}

export function ScoreRing({ score }: ScoreRingProps) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  let color = "var(--danger)";
  if (score >= 75) {color = "var(--success)";}
  else if (score >= 50) {color = "var(--warning)";}
  else if (score >= 25) {color = "var(--info)";}

  /* ── Animated counter ── */
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    if (!isInView) {return;}
    let frame: number;
    const start = performance.now();
    const duration = 1200; // ms

    function tick(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      // easeOutExpo
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayed(Math.round(eased * score));
      if (progress < 1) {frame = requestAnimationFrame(tick);}
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isInView, score]);

  return (
    <div ref={ref} className="relative inline-flex items-center justify-center">
      <svg width="140" height="140" viewBox="0 0 140 140">
        {/* Track ring */}
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth="10"
        />

        {/* Glow filter */}
        <defs>
          <filter id="score-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Animated progress arc */}
        <motion.circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          filter="url(#score-glow)"
          initial={{ strokeDashoffset: circumference }}
          animate={isInView ? { strokeDashoffset: offset } : {}}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute text-center">
        <motion.span
          className="text-3xl font-bold"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ delay: 0.3, type: "spring", stiffness: 200, damping: 12 }}
        >
          {displayed}
        </motion.span>
        <motion.span
          className="block text-xs"
          style={{ color: "var(--text-muted)" }}
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ delay: 0.8 }}
        >
          / 100
        </motion.span>
      </div>
    </div>
  );
}
