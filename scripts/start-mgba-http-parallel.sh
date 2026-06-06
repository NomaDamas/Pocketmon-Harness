#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_BIN="${ROOT_DIR}/.local-tools/mgba-http/mGBA-http-0.8.2-osx-arm64-self-contained"
BASE_DIR="${ROOT_DIR}/.pss-mgba/parallel-http"
HTTP_PORTS="${POKEMON_PARALLEL_MGBA_PORTS:-5100,5101,5102}"
SOCKET_BASE="${POKEMON_PARALLEL_SOCKET_BASE:-8888}"

if [[ ! -x "${SERVER_BIN}" ]]; then
  echo "missing executable mGBA-http server: ${SERVER_BIN}" >&2
  exit 1
fi

IFS=',' read -r -a PORTS <<< "${HTTP_PORTS}"
mkdir -p "${BASE_DIR}"

index=0
for raw_port in "${PORTS[@]}"; do
  http_port="$(echo "${raw_port}" | xargs)"
  if [[ -z "${http_port}" ]]; then
    continue
  fi
  socket_port=$((SOCKET_BASE + index))
  instance_dir="${BASE_DIR}/${index}"
  mkdir -p "${instance_dir}"
  cat > "${instance_dir}/appsettings.json" <<JSON
{
  "Logging": {
    "LogLevel": {
      "Default": "Warning",
      "Microsoft": "Warning",
      "System": "Error"
    }
  },
  "Kestrel": {
    "Endpoints": {
      "Http": {
        "Url": "http://localhost:${http_port}"
      }
    }
  },
  "mgba-http": {
    "Socket": {
      "IpAddress": "127.0.0.1",
      "Port": ${socket_port},
      "ReadTimeout": 3000,
      "WriteTimeout": 3000
    }
  },
  "AllowedHosts": "*"
}
JSON
  (
    cd "${instance_dir}"
    export DOTNET_BUNDLE_EXTRACT_BASE_DIR="${instance_dir}/dotnet-bundle"
    mkdir -p "${DOTNET_BUNDLE_EXTRACT_BASE_DIR}"
    "${SERVER_BIN}" > "${instance_dir}/mgba-http.log" 2>&1 &
    echo "$!" > "${instance_dir}/mgba-http.pid"
  )
  echo "started mGBA-http http=${http_port} socket=${socket_port} pid=$(cat "${instance_dir}/mgba-http.pid")"
  index=$((index + 1))
done
