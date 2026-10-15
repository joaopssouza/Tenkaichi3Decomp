import subprocess
import base64

SSH_HOST = "jpadmin@192.168.1.3"
SUDO_PASS = "010203"

REMOTE_CODE = """
import sqlite3
import json

db_path = '/mnt/nvme_data/docker/volumes/infra_npm_data/_data/database.sqlite'
con = sqlite3.connect(db_path)
cur = con.cursor()

tables = ['proxy_host', 'redirection_host', 'dead_host', 'stream', 'certificate', 'access_list']

has_errors = False
for table in tables:
    cur.execute("SELECT * FROM " + table)
    cols = [desc[0] for desc in cur.description]
    rows = cur.fetchall()
    print("Table: " + table + " (" + str(len(rows)) + " rows)")
    for row in rows:
        row_dict = dict(zip(cols, row))
        for col in ['domain_names', 'meta', 'locations', 'items', 'clients']:
            if col in row_dict and row_dict[col] is not None:
                val = row_dict[col]
                try:
                    parsed = json.loads(val)
                    if col == 'domain_names' and not isinstance(parsed, list):
                        print("  [ERROR NOT LIST] ID " + str(row_dict.get('id')) + " " + col + ": " + repr(val))
                        has_errors = True
                except Exception as e:
                    print("  [ERROR INVALID JSON] ID " + str(row_dict.get('id')) + " " + col + ": " + repr(val) + " -> " + str(e))
                    has_errors = True

if not has_errors:
    print("ALL JSON COLUMNS VALID AND WELL-FORMED!")
con.close()
"""

def main():
    b64 = base64.b64encode(REMOTE_CODE.encode('utf-8')).decode('ascii')
    remote_cmd = f"echo '{SUDO_PASS}' | sudo -S python3 -c \"$(echo '{b64}' | base64 -d)\""
    
    cmd = ["ssh", "-o", "StrictHostKeyChecking=no", SSH_HOST, remote_cmd]
    res = subprocess.run(cmd, capture_output=True, text=True)
    print("Output:")
    print(res.stdout)
    if res.stderr:
        print("Stderr:")
        print(res.stderr)

if __name__ == "__main__":
    main()
