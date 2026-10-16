#!/bin/bash
# Sync the repository's sources to optiplex:/home/jpadmin/bt3-staging, build (jspi + async), serve on 127.0.0.1:3999
# (container bt3-stg-srv) and run the given node tests against it through an ssh tunnel.
#   stage.sh [--no-build] [test files / node --test args...]
set -u
REPO="/d/PROJETOS/Projeto Engenharia Reversa"
OUT="$TEMP/stage_$(date +%H%M%S).out"
cd "$REPO"
if [ "${1:-}" != "--no-build" ]; then
  git ls-files -co --exclude-standard -- src include port/src port/include port/web/src port/web/target port/web/include > "$TEMP/srcfiles.txt"
  tar cf - -T "$TEMP/srcfiles.txt" | ssh optiplex 'tar xf - -C /home/jpadmin/bt3-staging && cd /home/jpadmin/bt3-staging && rm -f port/build/web/bt3-jspi.wasm && docker run --rm -v /home/jpadmin/bt3-staging:/src -w /src emscripten/emsdk:latest sh -c "python3 port/web/build.py > port/build/build.log 2>&1; grep -E \"FAILED|error:|files failed\" -A3 port/build/build.log | head -20; grep -q \"files failed\" port/build/build.log && exit 1; python3 port/web/link.py web 2>&1 | grep -E \"link OK|rror\"; python3 port/web/link.py webasync 2>&1 | grep -E \"link OK|rror\""'
  ssh optiplex test -f /home/jpadmin/bt3-staging/port/build/web/bt3-jspi.wasm || { echo "BUILD FAILED"; exit 1; }
else
  shift
fi
ssh optiplex 'docker ps --format "{{.Names}}" | grep -q bt3-stg-srv || docker run -d --name bt3-stg-srv -p 127.0.0.1:3999:3000 -v /home/jpadmin/bt3-staging/port/build/web:/app/port/build/web:ro -v /home/jpadmin/bt3-build/port/build/web/disc:/app/port/build/web/disc:ro -e DB_PATH=/tmp/s.json bt3-build-signaling >/dev/null'
[ $# -eq 0 ] && exit 0
ssh -N -L 3999:127.0.0.1:3999 optiplex & TUN=$!
sleep 3
BT3_BOOT_URL=http://localhost:3999/runtime.html timeout 1500 node --test --test-concurrency=1 "$@" > "$OUT" 2>&1
echo "tests exit $? (full output: $OUT)"
kill $TUN 2>/dev/null
grep -E "^(✔|✖)|^ℹ (pass|fail)" "$OUT" | head -20
grep -A6 "failing tests" "$OUT" | grep -E "Error|assert|expected|actual|did not|only|stopped" | head -10
