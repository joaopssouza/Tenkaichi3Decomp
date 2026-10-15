#!/usr/bin/env python3
"""The Tag Team mod's addresses in the game, tied to this decomp's names.

    python3 port/tools/tagteam_ledger.py <mod tools dir> --out docs/tagteam

The mod (The Mufti's, for PCSX2) changes the USA executable at run time: it hooks game functions and reads or writes
game variables, every one written as A(0x...) in its Python (native_map.A: the identity on the USA disc). This tool
lists them module by module and says which of this project's functions or variables each one is in, from the symbol
maps (config/symbols/*.txt, config/symbol_addrs.txt) and the segment layouts (config/SLUS_216.78.yaml for the
executable, config/DBZP.yaml for the menu overlay at 0x334C00). Addresses from 0x02000000 up are the mod's own memory
(PCSX2's extended RAM: its code caves and tables), not the game's.

Output: <out>/ledger.json (every reference) and <out>/ledger.md (by module, hooks first)."""
import argparse, glob, json, os, re, sys
from bisect import bisect_right

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MOD_MEMORY = 0x02000000
CODE_TYPES = {"c", "asm", "textbin", "hasm"}

SYM_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(0x[0-9A-Fa-f]+)\s*;(.*)$")
SEG_LIST_RE = re.compile(r"^\s*-\s*\[\s*(0x[0-9A-Fa-f]+)\s*,\s*([A-Za-z.]+)\s*,\s*([^\],]+?)\s*[\],]")
SEG_DICT_RE = re.compile(r"^\s*-\s*\{\s*type:\s*([A-Za-z.]+)\s*,\s*vram:\s*(0x[0-9A-Fa-f]+)\s*,\s*name:\s*([^}\s,]+)")
VRAM_RE = re.compile(r"^\s*vram:\s*(0x[0-9A-Fa-f]+)")
START_RE = re.compile(r"^\s*start:\s*(0x[0-9A-Fa-f]+)")
A_RE = re.compile(r"\bA\(\s*(0x[0-9A-Fa-f]+)\s*\)")
ASSIGN_RE = re.compile(r"^\s*([A-Z][A-Z0-9_]*)\s*=\s*A\(\s*(0x[0-9A-Fa-f]+)\s*\)\s*(#.*)?$")


def load_symbols(paths):
    """[(address, name, is_function)], by address."""
    out = {}
    for p in paths:
        with open(p, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = SYM_RE.match(line)
                if m:
                    out[int(m.group(2), 16)] = (m.group(1), "type:func" in m.group(3))
    return sorted((a, n, fn) for a, (n, fn) in out.items())


def load_segments(paths):
    """[(vram, file, type)], by vram: the layout's subsegments, vram = segment vram + (offset - segment start)."""
    out = []
    for p in paths:
        vram = start = None
        with open(p, encoding="utf-8", errors="replace") as f:
            for line in f:
                if vram is None:
                    m = START_RE.match(line)
                    if m:
                        start = int(m.group(1), 16)
                    m = VRAM_RE.match(line)
                    if m:
                        vram = int(m.group(1), 16)
                    continue
                m = SEG_LIST_RE.match(line)
                if m:
                    out.append((vram + int(m.group(1), 16) - (start or 0), m.group(3).strip(), m.group(2).lstrip(".")))
                    continue
                m = SEG_DICT_RE.match(line)
                if m:
                    out.append((int(m.group(2), 16), m.group(3).strip(), m.group(1).lstrip(".")))
    return sorted(set(out))


def _segment(addr, segments):
    i = bisect_right(segments, (addr, "￿", "￿")) - 1
    return segments[i] if i >= 0 else None


def resolve(addr, symbols, segments):
    """Where an address of the game is in this project: {addr, kind, symbol, offset, file}.
    kind: exact (a symbol there), inside (in the function, or after the variable, before it), mod-memory, unknown."""
    r = {"addr": addr, "kind": "unknown", "symbol": None, "offset": None, "file": None}
    if addr >= MOD_MEMORY:
        r["kind"] = "mod-memory"
        return r
    seg = _segment(addr, segments)
    if seg is None:
        return r
    r["file"] = seg[1]
    # the overlay has no symbols of its own here (config/symbol_addrs_dbzp.txt is empty): no guess from the main
    # executable's names, whose addresses are all below it
    overlay_start = min((s[0] for s in segments if s[1].startswith("menu/")), default=None)
    if overlay_start is not None and addr >= overlay_start:
        return r
    code = seg[2] in CODE_TYPES
    pool = [s for s in symbols if s[2]] if code else symbols
    i = bisect_right(pool, (addr, "￿", True)) - 1
    if i < 0:
        return r
    a, name, _ = pool[i]
    # (a symbol from an earlier segment is a different file: still the nearest name, but say which file it is in)
    r.update(kind="exact" if a == addr else "inside", symbol=name, offset=addr - a)
    return r


def scan_module(path):
    """Every A(0x...) of a mod file: [{name, addr, line, role}]; role hook for HOOK/ENTRY constants."""
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for n, line in enumerate(f, 1):
            m = ASSIGN_RE.match(line)
            if m:
                name = m.group(1)
                out.append({"name": name, "addr": int(m.group(2), 16), "line": n,
                            "role": "hook" if ("HOOK" in name or "ENTRY" in name) else "ref"})
                continue
            for a in A_RE.findall(line):
                out.append({"name": None, "addr": int(a, 16), "line": n, "role": "ref"})
    return out


def build(mod_dir, symbols, segments):
    modules = {}
    for p in sorted(glob.glob(os.path.join(mod_dir, "*.py"))):
        refs = scan_module(p)
        if refs:
            modules[os.path.basename(p)] = [dict(ref, **{k: v for k, v in resolve(ref["addr"], symbols, segments).items() if k != "addr"})
                                            for ref in refs]
    return modules


def markdown(modules):
    out = ["# Tag Team mod: game addresses and this decomp's names", "",
           "Generated by `port/tools/tagteam_ledger.py`. kind: exact = a symbol at the address; inside = within that "
           "function (or after that variable) at the offset; mod-memory = the mod's own memory (0x02000000 and up); "
           "unknown = no symbol here (the menu overlay, or before the first symbol).", ""]
    hooks = sorted({(r["addr"], r["symbol"], r["offset"], r["kind"]) for refs in modules.values() for r in refs if r["role"] == "hook"})
    out += ["## All hook points", "", "| address | where | modules |", "|---|---|---|"]
    for a, sym, off, kind in hooks:
        mods = sorted(m for m, refs in modules.items() if any(r["addr"] == a and r["role"] == "hook" for r in refs))
        out.append(f"| `{a:#08x}` | {_where(sym, off, kind)} | {', '.join(mods)} |")
    out.append("")
    for mod, refs in modules.items():
        out += [f"## {mod}", "", "| line | constant | address | where | file | role |", "|---|---|---|---|---|---|"]
        for r in sorted(refs, key=lambda r: (r["role"] != "hook", r["line"])):
            out.append(f"| {r['line']} | {r['name'] or ''} | `{r['addr']:#08x}` | {_where(r['symbol'], r['offset'], r['kind'])} | "
                       f"{r['file'] or ''} | {r['role']} |")
        out.append("")
    return "\n".join(out)


def _where(sym, off, kind):
    if kind == "mod-memory":
        return "(mod memory)"
    if sym is None:
        return "(no symbol)"
    return f"`{sym}`" if off == 0 else f"`{sym}+{off:#x}`"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("mod_dir")
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "tagteam"))
    a = ap.parse_args(argv)
    symbols = load_symbols(glob.glob(os.path.join(ROOT, "config", "symbols", "*.txt")) + [os.path.join(ROOT, "config", "symbol_addrs.txt")])
    segments = load_segments([os.path.join(ROOT, "config", "SLUS_216.78.yaml"), os.path.join(ROOT, "config", "DBZP.yaml")])
    modules = build(a.mod_dir, symbols, segments)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "ledger.json"), "w", encoding="utf-8") as f:
        json.dump(modules, f, indent=1)
    with open(os.path.join(a.out, "ledger.md"), "w", encoding="utf-8") as f:
        f.write(markdown(modules) + "\n")
    refs = [r for v in modules.values() for r in v]
    kinds = {k: sum(1 for r in refs if r["kind"] == k) for k in ("exact", "inside", "mod-memory", "unknown")}
    print(f"{len(modules)} modules, {len(refs)} references, {len({r['addr'] for r in refs})} addresses: {kinds}")


if __name__ == "__main__":
    sys.exit(main())
