import os, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEX_DIR = ROOT / "Tenkaichi3Decomp/textures/SLUS-21678"
OUT_JSON = ROOT / "port/build/web/textures_index.json"

def main():
    print(f"Indexing textures from {TEX_DIR}...")
    textures = []
    prefix_len = len(str(TEX_DIR)) + 1
    for root, dirs, files in os.walk(TEX_DIR):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in ('.dds', '.png'):
                rel_path = os.path.join(root, f)[prefix_len:].replace('\\', '/')
                textures.append(rel_path)
    
    textures.sort()
    print(f"Found {len(textures)} textures. Writing to {OUT_JSON}...")
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as out:
        json.dump(textures, out)
    print(f"textures_index.json created ({OUT_JSON.stat().st_size:,} bytes).")

if __name__ == '__main__':
    main()
