#!/usr/bin/env python3
"""Validates the live Docker container stack for Tenkaichi 3 Web Self-Hosted deployment.
Executes HTTP probes against the running containers via docker network.
"""

import subprocess
import sys

def run_probe(cmd):
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return res.returncode, res.stdout, res.stderr

def main():
    print("=================================================================")
    print("       Tenkaichi 3 Web - Docker Stack Automated Verification     ")
    print("=================================================================")

    # 1. Check containers running
    code, out, _ = run_probe('docker ps --filter "name=bt3" --format "{{.Names}}: {{.Status}}"')
    if code != 0 or not out.strip():
        print("FAIL: Containers are not running. Run 'docker compose up -d' first.")
        sys.exit(1)
    print("Containers running:")
    for line in out.strip().splitlines():
        print(f"  - {line}")

    # 2. Test HTTP probes through web container reverse proxy
    cmd = [
        "docker", "run", "--rm",
        "--network", "projetoengenhariareversa_bt3-net",
        "alpine", "sh", "-c",
        "apk add --no-cache curl > /dev/null 2>&1 && curl -s -i http://web/health && curl -s -I http://web/index.html && curl -s -I http://web/disc.iso"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"FAIL: Probe failed inside docker network: {res.stderr}")
        sys.exit(1)
    out = res.stdout

    print("\nProbing live Nginx and Signaling containers:")
    has_ok = "status\":\"ok" in out
    has_coop = "Cross-Origin-Opener-Policy: same-origin" in out
    has_coep = "Cross-Origin-Embedder-Policy: require-corp" in out
    has_ranges = "Accept-Ranges: bytes" in out

    print(f"  [PASS] Reverse Proxy Health Status OK: {has_ok}")
    print(f"  [PASS] Cross-Origin-Opener-Policy (COOP): {has_coop}")
    print(f"  [PASS] Cross-Origin-Embedder-Policy (COEP): {has_coep}")
    print(f"  [PASS] HTTP Accept-Ranges (Partial Content): {has_ranges}")

    if not (has_ok and has_coop and has_coep and has_ranges):
        print("\nFAIL: One or more validation checks failed.")
        sys.exit(1)

    print("\nALL DOCKER STACK CHECKS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    main()
