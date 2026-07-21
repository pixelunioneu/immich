#!/usr/bin/env bash

# Ephemeral Microservices Orchestrator
# ------------------------------------
# Runs inside the Immich API container (same-container scope; no
# Kubernetes/Docker-API-driven pod scaling). It starts a temporary
# `microservices` worker subprocess when the API notifies it of newly
# enqueued work, and stops it after the queues drain and stay idle for a
# configurable period.
#
# Start trigger is push-based: the API writes to a FIFO (named pipe) when it
# enqueues a job (see `notifyMicroservicesWake()` in job.repository.ts). This
# script blocks on that FIFO instead of polling Redis, so it costs zero CPU
# and zero Redis queries while idle. A wake is trusted as-is (the job that
# triggered it was just enqueued) -- no confirmatory Redis check is made.
#
# The stop side is unchanged: while the subprocess is running, the loop polls
# BullMQ queue totals (via `immich-admin queue-stats`) on CHECK_INTERVAL to
# detect drain + idle, since that side isn't latency-sensitive.
#
# Assumptions:
#  - The main container process is already running the API (only) or at least
#    not running the microservices worker (i.e. IMMICH_WORKERS_INCLUDE does not
#    already include "microservices").
#  - `start.sh` and `immich-admin` are on PATH (they are in the official image).
#  - The build artifacts exist at server/dist (normal for released images).
#
# Environment variables (override as needed):
#   WAKE_FIFO_PATH          Path to the wake FIFO (default: /tmp/immich_microservices.wake)
#   CHECK_INTERVAL          Seconds between idle-drain polls while running (default: 10)
#   IDLE_AFTER_COMPLETE     Continuous idle seconds (waiting=0 & active=0) before stopping (default: 60)
#   GRACEFUL_TIMEOUT        Seconds to wait after SIGTERM before SIGKILL (default: 30)
#   VERBOSE                 If set to non-empty, enables extra logging
#   EXTRA_START_ENV         Extra env vars to export when starting microservices (format KEY=VAL space separated)
#
# Exit codes:
#   0  Normal exit (terminated by signal or EOF)
#   1  Unhandled error in script logic

set -euo pipefail

WAKE_FIFO_PATH="${WAKE_FIFO_PATH:-/tmp/immich_microservices.wake}"
CHECK_INTERVAL="${CHECK_INTERVAL:-10}"
IDLE_AFTER_COMPLETE="${IDLE_AFTER_COMPLETE:-60}"
GRACEFUL_TIMEOUT="${GRACEFUL_TIMEOUT:-30}"
PID_FILE="/tmp/immich_ephemeral_microservices.pid"
LOG_TAG="[ephemeral-microservices]"
VERBOSE=1

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${LOG_TAG} $*"
}

vlog() {
  if [[ -n "${VERBOSE:-}" ]]; then
    log "$@"
  fi
}

error() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${LOG_TAG} ERROR: $*" >&2
}

cleanup() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(<"$PID_FILE")" || true
    if [[ -n "$pid" && -d "/proc/$pid" ]]; then
      vlog "Script exiting; ensuring microservices process $pid is terminated"
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

get_total() {
  local state="$1" value
  if ! value="$(node ./server/scripts/queue-stats.js --total "$state" --exclude backgroundTask 2>/dev/null | tr -d '\r')"; then
    echo "-1"
    return 0
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "-1"
    return 0
  fi
  echo "$value"
}

micro_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(<"$PID_FILE")" || true
    if [[ -n "$pid" && -d "/proc/$pid" ]]; then
      return 0
    fi
  fi
  return 1
}

start_micro() {
  if micro_running; then
    vlog "Microservices already running (pid $(<"$PID_FILE"))"
    return 0
  fi
  log "Starting microservices worker (wake received)"
  # Start only the microservices worker by constraining IMMICH_WORKERS_INCLUDE.
  # Use a subshell to isolate environment.
  (
    export IMMICH_WORKERS_INCLUDE="microservices"
    # Accept optional additional environment overrides.
    if [[ -n "${EXTRA_START_ENV:-}" ]]; then
      # shellcheck disable=SC2086,SC2046
      for kv in ${EXTRA_START_ENV}; do
        # Expect KEY=VAL format; split on first '='
        key="${kv%%=*}"
        val="${kv#*=}"
        export "${key}=${val}"
      done
    fi
    # start.sh will exec node main.js; we place it in background via sh -c wrapper.
    start.sh &
    echo $! > "$PID_FILE"
  )
  sleep 2
  if micro_running; then
    log "Microservices started (pid $(<"$PID_FILE"))"
  else
    error "Failed to start microservices"
    rm -f "$PID_FILE" || true
  fi
}

stop_micro() {
  if ! micro_running; then
    return 0
  fi
  local pid
  pid="$(<"$PID_FILE")"
  log "Stopping microservices process $pid"
  kill "$pid" 2>/dev/null || true
  local waited=0

  # kill perl processes too that run exif_tool
  for PID_DIR in /proc/[0-9]*; do
    # Check if the process directory exists and contains a cmdline file
    if [ -f "$PID_DIR/cmdline" ]; then

        # Check if "perl" is found in the command line (case-insensitive grep)
        # The -q option keeps grep quiet, only using its exit code.
        if grep -q -i 'perl' "$PID_DIR/cmdline"; then
            PERL_PID=$(basename "$PID_DIR")
            log "Killing perl process with PID: $PERL_PID"
            kill "$PERL_PID" 2>/dev/null || true
        fi
    fi
  done

  while micro_running && [[ $waited -lt $GRACEFUL_TIMEOUT ]]; do
    sleep 1
    waited=$((waited+1))
  done
  if micro_running; then
    error "Microservices did not exit after ${GRACEFUL_TIMEOUT}s; sending SIGKILL"
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE" || true
}

if [[ ! -p "$WAKE_FIFO_PATH" ]]; then
  vlog "Creating wake FIFO at $WAKE_FIFO_PATH"
  rm -f "$WAKE_FIFO_PATH"
  mkfifo "$WAKE_FIFO_PATH"
fi

log "Starting ephemeral microservices monitor. WakeFifo=${WAKE_FIFO_PATH} Interval=${CHECK_INTERVAL}s Idle=${IDLE_AFTER_COMPLETE}s"

idle_start=0

while true; do
  if micro_running; then
    # Subprocess is up: wait for a wake with a timeout so we still poll for
    # drain/idle. A wake received here is a harmless no-op (already running).
    read -r -t "$CHECK_INTERVAL" _line < "$WAKE_FIFO_PATH" || true

    waiting_total=$(get_total waiting)
    active_total=$(get_total active)

    if [[ $waiting_total -lt 0 || $active_total -lt 0 ]]; then
      error "Failed to read queue stats (waiting=$waiting_total active=$active_total). Will retry."
      continue
    fi

    vlog "Queue totals: waiting=$waiting_total active=$active_total"

    if [[ $waiting_total -eq 0 && $active_total -eq 0 ]]; then
      if [[ $idle_start -eq 0 ]]; then
        idle_start=$(date +%s)
        vlog "Queues drained; starting idle timer"
      else
        now=$(date +%s)
        elapsed=$((now - idle_start))
        if [[ $elapsed -ge $IDLE_AFTER_COMPLETE ]]; then
          log "Idle period (${elapsed}s) exceeded threshold; stopping microservices"
          stop_micro
          idle_start=0
        fi
      fi
    else
      # Work resumed; reset idle timer
      if [[ $idle_start -ne 0 ]]; then
        vlog "Work resumed; resetting idle timer"
      fi
      idle_start=0
    fi
  else
    # Subprocess is not up: block indefinitely on the FIFO. Zero CPU, zero
    # Redis queries while truly idle.
    vlog "Waiting for wake on $WAKE_FIFO_PATH"
    read -r _line < "$WAKE_FIFO_PATH" || true
    start_micro
    idle_start=0
  fi
done
