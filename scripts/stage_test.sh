#!/usr/bin/env bash
set -euo pipefail

# Configuration
OPTIPLEX_HOST="${OPTIPLEX_HOST:-optiplex}"
STAGING_DIR="${STAGING_DIR:-/home/jpadmin/bt3-staging}"
EMSDK_IMAGE="${EMSDK_IMAGE:-emscripten/emsdk:6.0.12}"
TEST_CONTAINER="${TEST_CONTAINER:-bt3-stg-srv}"
TEST_IMAGE="${TEST_IMAGE:-bt3-build-signaling}"
TEST_PORT="${TEST_PORT:-3999}"

# Ensure we run from repository root
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "================================================================"
echo "          Tenkaichi 3 Web - Staging Build & Test Deploy         "
echo "================================================================"
echo "Host:             ${OPTIPLEX_HOST}"
echo "Staging Dir:      ${STAGING_DIR}"
echo "Emscripten Image: ${EMSDK_IMAGE}"
echo "Test Container:   ${TEST_CONTAINER} (port ${TEST_PORT})"
echo "================================================================"

# (1) Send versioned files via tar over SSH
echo "==> [1/3] Enviando arquivos versionados para ${OPTIPLEX_HOST}:${STAGING_DIR}..."
TARGET_PATHS=(
  "src"
  "include"
  "port/src"
  "port/include"
  "port/web/src"
  "port/web/target"
  "port/web/include"
  "port/web/make_icons.py"
)

git ls-files "${TARGET_PATHS[@]}" | tar -czf - -T - | ssh -o ClearAllForwardings=yes "${OPTIPLEX_HOST}" "tar -xzf - -C '${STAGING_DIR}'"
echo "Arquivos enviados com sucesso."

# (2) Compile with docker emscripten/emsdk in staging
echo "==> [2/3] Compilando no staging com docker ${EMSDK_IMAGE}..."
ssh -o ClearAllForwardings=yes "${OPTIPLEX_HOST}" "docker run --rm -v '${STAGING_DIR}:/src' '${EMSDK_IMAGE}' sh -c 'python3 port/web/build.py && python3 port/web/link.py web && python3 port/web/link.py webasync'"
echo "Compilação concluída com sucesso."

# (3) Bring up test container
echo "==> [3/3] Subindo container de teste '${TEST_CONTAINER}'..."
ssh -o ClearAllForwardings=yes "${OPTIPLEX_HOST}" "
  docker rm -f '${TEST_CONTAINER}' 2>/dev/null || true
  docker run -d --name '${TEST_CONTAINER}' \
    -p 127.0.0.1:${TEST_PORT}:3000 \
    -v '${STAGING_DIR}/port/build/web:/app/port/build/web:ro' \
    -v /home/jpadmin/bt3-build/port/build/web/disc:/app/port/build/web/disc:ro \
    -e DB_PATH=/tmp/s.json \
    '${TEST_IMAGE}'
"

# Verification
echo "==> Verificando saúde do container de teste..."
READY=0
for i in {1..15}; do
  if ssh -o ClearAllForwardings=yes "${OPTIPLEX_HOST}" "curl -s -f http://127.0.0.1:${TEST_PORT}/health >/dev/null"; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -eq 1 ]; then
  echo "Container ${TEST_CONTAINER} está online e saudável!"
  ssh -o ClearAllForwardings=yes "${OPTIPLEX_HOST}" "curl -s http://127.0.0.1:${TEST_PORT}/health"
  echo ""
else
  echo "AVISO: Container iniciado, mas endpoint /health não respondeu a tempo."
fi

echo "================================================================"
echo "          Deploy em staging finalizado com sucesso!             "
echo "================================================================"
