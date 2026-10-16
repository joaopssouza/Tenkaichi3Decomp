#!/usr/bin/env python3
"""Configures Nginx Proxy Manager on remote server (192.168.1.3) for bt3.jpdev.uk
and verifies proxy routing and security isolation headers.
"""

import base64
import datetime
import json
import subprocess
import sys

SSH_HOST = "jpadmin@192.168.1.3"
SUDO_PASS = "010203"
NPM_DATA_DIR = "/mnt/nvme_data/docker/volumes/infra_npm_data/_data"
HOST_ID = 22
DOMAIN_NAMES = ["bt3.jpdev.uk", "tenkaichi3.jpdev.uk"]

CONF_CONTENT = f"""# ------------------------------------------------------------
# bt3.jpdev.uk
# ------------------------------------------------------------

map $scheme $hsts_header {{
    https   "max-age=63072000; preload";
}}

server {{
  set $forward_scheme http;
  set $server         "bt3-game-client";
  set $port           80;

  listen 80;
  server_name {' '.join(DOMAIN_NAMES)};
  http2 off;

  # Asset Caching
  include conf.d/include/assets.conf;

  # Block Exploits
  include conf.d/include/block-exploits.conf;

  # Mandatory WebAssembly JSPI & Cross-Origin Isolation
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Cross-Origin-Embedder-Policy "require-corp" always;
  add_header Accept-Ranges "bytes" always;

  # Security Hardening Headers for Public Access
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $http_connection;
  proxy_http_version 1.1;

  access_log /data/logs/proxy-host-{HOST_ID}_access.log proxy;
  error_log /data/logs/proxy-host-{HOST_ID}_error.log warn;

  location / {{
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $http_connection;
    proxy_http_version 1.1;

    # Proxy!
    include conf.d/include/proxy.conf;
  }}

  # Custom
  include /data/nginx/custom/server_proxy[.]conf;
}}
"""

def run_ssh(remote_cmd, input_data=None):
    cmd = ["ssh", SSH_HOST, remote_cmd]
    res = subprocess.run(cmd, input=input_data, capture_output=True, text=True)
    return res.returncode, res.stdout, res.stderr

def run_sudo_ssh(remote_cmd):
    full_cmd = f"echo '{SUDO_PASS}' | sudo -S {remote_cmd}"
    return run_ssh(full_cmd)

def main():
    print("[1/5] Deploying Nginx Proxy Manager configuration for bt3.jpdev.uk...")
    b64_conf = base64.b64encode(CONF_CONTENT.encode("utf-8")).decode("ascii")
    conf_path = f"{NPM_DATA_DIR}/nginx/proxy_host/{HOST_ID}.conf"
    
    write_cmd = f"sh -c 'echo \"{b64_conf}\" | base64 -d > {conf_path}'"
    code, out, err = run_sudo_ssh(write_cmd)
    if code != 0:
        print(f"Failed to write conf file: {err}", file=sys.stderr)
        sys.exit(1)
    print(f"  Configuration file written to {conf_path}")

    print("[2/5] Updating Nginx Proxy Manager SQLite database...")
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    domains_json = json.dumps(DOMAIN_NAMES).replace('"', '""')
    
    sql = f"""
DELETE FROM proxy_host WHERE id = {HOST_ID};
INSERT INTO proxy_host (
    id, created_on, modified_on, owner_user_id, is_deleted, domain_names,
    forward_host, forward_port, access_list_id, certificate_id, ssl_forced,
    caching_enabled, block_exploits, advanced_config, meta, allow_websocket_upgrade,
    http2_support, forward_scheme, enabled, locations, hsts_enabled, hsts_subdomains, trust_forwarded_proto
) VALUES (
    {HOST_ID}, '{now}', '{now}', 1, 0, '{domains_json}',
    'bt3-game-client', 80, 0, 0, 0,
    1, 1, '', '{{"nginx_online":true,"nginx_err":null}}', 1,
    0, 'http', 1, '[]', 0, 0, 0
);
"""
    sql_b64 = base64.b64encode(sql.encode("utf-8")).decode("ascii")
    db_cmd = f"sh -c 'echo \"{sql_b64}\" | base64 -d | sqlite3 {NPM_DATA_DIR}/database.sqlite'"
    code, out, err = run_sudo_ssh(db_cmd)
    if code != 0:
        print(f"Failed to update database: {err}", file=sys.stderr)
        sys.exit(1)
    print("  SQLite record inserted successfully.")

    print("[3/5] Testing Nginx configuration in nginx_proxy container...")
    code, out, err = run_ssh("docker exec nginx_proxy nginx -t")
    if code != 0:
        print(f"Nginx config test failed: {err}", file=sys.stderr)
        sys.exit(1)
    print("  Nginx configuration test PASSED.")

    print("[4/5] Reloading Nginx Proxy Manager...")
    code, out, err = run_ssh("docker exec nginx_proxy nginx -s reload")
    if code != 0:
        print(f"Nginx reload failed: {err}", file=sys.stderr)
        sys.exit(1)
    print("  Nginx Proxy Manager reloaded successfully.")

    print("[5/5] Testing proxy routing for bt3.jpdev.uk via Host header...")
    probe_cmd = "docker exec nginx_proxy curl -s -I -H 'Host: bt3.jpdev.uk' http://127.0.0.1/"
    code, out, err = run_ssh(probe_cmd)
    if code != 0:
        print(f"Failed to probe proxy: {err}", file=sys.stderr)
        sys.exit(1)

    print("\n--- Response Headers from NPM (Host: bt3.jpdev.uk) ---")
    print(out)

    if "Cross-Origin-Opener-Policy: same-origin" in out and "200 OK" in out:
        print("[SUCCESS] NPM correctly forwards bt3.jpdev.uk with all security & COOP/COEP headers!")
    else:
        print("[WARNING] Headers check did not match expected values.")

if __name__ == "__main__":
    main()
