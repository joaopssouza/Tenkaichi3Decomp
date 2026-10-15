#!/usr/bin/env python3
import json
import sqlite3
import subprocess
import sys

SSH_HOST = "jpadmin@192.168.1.3"
SUDO_PASS = "010203"
DB_PATH = "/mnt/nvme_data/docker/volumes/infra_npm_data/_data/database.sqlite"

# Remote python script to execute with sudo
REMOTE_CODE = """
import sqlite3
import json

db_path = '/mnt/nvme_data/docker/volumes/infra_npm_data/_data/database.sqlite'
con = sqlite3.connect(db_path)
cur = con.cursor()

# Set clean, valid JSON array for domain_names
valid_json = json.dumps(['bt3.jpdev.uk', 'tenkaichi3.jpdev.uk'])
cur.execute('UPDATE proxy_host SET domain_names = ? WHERE id = 22', (valid_json,))
con.commit()

cur.execute('SELECT id, domain_names FROM proxy_host WHERE id = 22')
print('Updated row:', cur.fetchone())
con.close()
"""

def main():
    import base64
    b64 = base64.b64encode(REMOTE_CODE.encode('utf-8')).decode('ascii')
    remote_cmd = f"echo '{SUDO_PASS}' | sudo -S python3 -c \"$(echo '{b64}' | base64 -d)\""
    
    cmd = ["ssh", SSH_HOST, remote_cmd]
    res = subprocess.run(cmd, capture_output=True, text=True)
    print("Return code:", res.returncode)
    print("Output:", res.stdout)
    if res.stderr:
        print("Error:", res.stderr)

if __name__ == "__main__":
    main()
