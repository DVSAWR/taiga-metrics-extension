#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

services=(taiga-metrics taiga-metrics-worker taiga-metrics-db)
env_files=(--env-file .env)
if [[ -f taiga-metrics.env ]]; then
  env_files+=(--env-file taiga-metrics.env)
fi

compose() {
  docker compose -f docker-compose.yml -f taiga-metrics.yml "${env_files[@]}" "$@"
}

usage() {
  cat <<'USAGE'
Usage: ./taiga-metrics.sh <command>

  up        Start the extension (Taiga keeps running as it is)
  update    Pull the image set in taiga-metrics.yml and restart the extension
  stop      Stop the extension
  remove    Stop the extension and remove its containers, keeping its data
  status    Show the extension's containers
  logs      Follow the extension's logs
  sync      Copy Taiga's data into the extension right now
  compose   Run any docker compose command with the extension's files
USAGE
}

case "${1:-}" in
  up) compose up -d "${services[@]}" ;;
  update) compose pull "${services[@]}" && compose up -d "${services[@]}" ;;
  stop) compose stop "${services[@]}" ;;
  remove) compose rm --stop --force "${services[@]}" ;;
  status) compose ps "${services[@]}" ;;
  logs) compose logs -f taiga-metrics taiga-metrics-worker ;;
  sync) compose exec taiga-metrics python -m taiga_metrics sync ;;
  compose) shift && compose "$@" ;;
  *) usage && exit 1 ;;
esac
