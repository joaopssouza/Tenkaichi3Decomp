import struct
import hashlib
import pathlib
import subprocess
import sys

ROM_BASE, ROM_END = 0x100000, 0x2FF180
ROM_SHA1 = "caee6c2269bba89fc51eea9e7beac3adbec9dc52"
DBZP_SHA1 = "4f910969e05d9b25c83af7642b60da9949a4348b"

ROOT = pathlib.Path(__file__).resolve().parents[1]
DISC = ROOT / "disc"
DISC_BIN = DISC / "BIN"
DISC_BIN.mkdir(parents=True, exist_ok=True)

elf_path = ROOT / "Tenkaichi3Decomp/gamedata/disc/SLUS_216.78"
dbzp_path = ROOT / "Tenkaichi3Decomp/gamedata/disc/BIN/DBZP.BIN"

# 1. Prepare flat image for SLUS
b = elf_path.read_bytes()
shoff, = struct.unpack_from("<I", b, 0x20)
shentsize, shnum = struct.unpack_from("<HH", b, 0x2E)
out = bytearray(ROM_END - ROM_BASE)
for i in range(shnum):
    _, kind, flags, addr, off, size = struct.unpack_from("<6I", b, shoff + i * shentsize)
    if flags & 2 and kind != 8 and size and ROM_BASE <= addr and addr + size <= ROM_END:
        out[addr - ROM_BASE:addr - ROM_BASE + size] = b[off:off + size]

rom_bytes = bytes(out)
assert hashlib.sha1(rom_bytes).hexdigest() == ROM_SHA1, "ROM SHA1 mismatch"
(DISC / "SLUS_216.78.rom").write_bytes(rom_bytes)
print("Created disc/SLUS_216.78.rom")

# 2. Copy DBZP.BIN
dbzp_bytes = dbzp_path.read_bytes()
assert hashlib.sha1(dbzp_bytes).hexdigest() == DBZP_SHA1, "DBZP SHA1 mismatch"
(DISC_BIN / "DBZP.BIN").write_bytes(dbzp_bytes)
print("Created disc/BIN/DBZP.BIN")

# 3. Copy SLUS_216.78 elf
(DISC / "SLUS_216.78").write_bytes(elf_path.read_bytes())
print("Created disc/SLUS_216.78")

# 4. Run splat
print("Running splat for SLUS_216.78...")
subprocess.run([sys.executable, "-m", "splat", "split", str(ROOT / "config/SLUS_216.78.yaml")], cwd=ROOT, check=True)
print("Running splat for DBZP...")
subprocess.run([sys.executable, "-m", "splat", "split", str(ROOT / "config/DBZP.yaml")], cwd=ROOT, check=True)
print("Splat splitting complete!")
