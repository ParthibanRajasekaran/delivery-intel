#!/bin/sh
# ============================================================================
# Delivery Intel — Docker Entrypoint
# ============================================================================
# Supports two modes:
#   dashboard (default) — starts the Next.js web server on port 3000
#   cli <args>          — runs the CLI analyzer
# ============================================================================

set -e

MODE="${1:-dashboard}"

case "$MODE" in
  dashboard|web|server)
    echo "🚀 Starting Delivery Intel dashboard on port ${PORT:-3000}..."
    exec npx next start -p "${PORT:-3000}"
    ;;
  cli|analyze)
    shift
    exec node /app/bin/delivery-intel.js "$@"
    ;;
  *)
    # If user passes a repo slug directly, treat it as CLI mode
    if echo "$MODE" | grep -q '/'; then
      exec node /app/bin/delivery-intel.js "$@"
    fi
    echo "Unknown mode: $MODE"
    echo "Usage:"
    echo "  docker run delivery-intel                          # Start dashboard"
    echo "  docker run delivery-intel cli vercel/next.js       # Run CLI"
    exit 1
    ;;
esac
