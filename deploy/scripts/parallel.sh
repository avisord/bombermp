#!/usr/bin/env bash
# Parallel job runner.
# Source this file; enable with --parallel flag or PARALLEL=true env var.

PARALLEL_ENABLED="${PARALLEL:-false}"
_PARALLEL_JOBS_RUNNING=0

run_parallel() {
  if [[ "$PARALLEL_ENABLED" == "true" ]]; then
    "$@" &
    _PARALLEL_JOBS_RUNNING=$((_PARALLEL_JOBS_RUNNING + 1))

    # Throttle to MAX_PARALLEL_JOBS
    while (( _PARALLEL_JOBS_RUNNING >= MAX_PARALLEL_JOBS )); do
      wait -n 2>/dev/null || true
      _PARALLEL_JOBS_RUNNING=$((_PARALLEL_JOBS_RUNNING - 1))
    done
  else
    "$@"
  fi
}

wait_all() {
  wait
  _PARALLEL_JOBS_RUNNING=0
}
