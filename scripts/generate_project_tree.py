#!/usr/bin/env python3
"""Gera um arquivo de texto com a árvore completa de diretórios e arquivos do projeto."""

import datetime
import os
import pathlib

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
OUTPUT_FILE = ROOT_DIR / "estrutura_projeto.txt"

EXCLUDE_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".pytest_cache"}
MAX_FILES_PER_DIR = 30

def main():
    total_dirs = 0
    total_files = 0
    extension_counts = {}

    print("[1/3] Mapeando estatísticas...")
    for p in ROOT_DIR.rglob("*"):
        parts = p.parts
        if any(ex in parts for ex in EXCLUDE_DIRS):
            continue
        if p.is_dir():
            total_dirs += 1
        else:
            total_files += 1
            ext = p.suffix.lower() or "(sem extensao)"
            extension_counts[ext] = extension_counts.get(ext, 0) + 1

    lines = []
    lines.append("=" * 80)
    lines.append("ESTRUTURA DE DIRETÓRIOS E ARQUIVOS DO PROJETO")
    lines.append("Projeto: Dragon Ball Z Budokai Tenkaichi 3 - Decompilação & Web Port")
    lines.append(f"Data de Geração: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"Diretório Raiz: {ROOT_DIR}")
    lines.append("=" * 80)
    lines.append("")
    lines.append("ESTATÍSTICAS GERAIS (excluindo .git e node_modules):")
    lines.append(f"  - Total de Diretórios: {total_dirs:,}")
    lines.append(f"  - Total de Arquivos:    {total_files:,}")
    lines.append("")
    lines.append("PRINCIPAIS TIPOS DE ARQUIVOS:")
    sorted_exts = sorted(extension_counts.items(), key=lambda x: x[1], reverse=True)[:20]
    for ext, count in sorted_exts:
        lines.append(f"  - {ext:16} : {count:6,} arquivos")
    lines.append("")
    lines.append("=" * 80)
    lines.append("ÁRVORE HIERÁRQUICA DO PROJETO")
    lines.append("=" * 80)
    lines.append("")
    lines.append(f"{ROOT_DIR.name}/")

    print("[2/3] Construindo a árvore hierárquica...")
    def walk(directory, prefix=""):
        try:
            entries = sorted(list(directory.iterdir()), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return

        entries = [e for e in entries if e.name not in EXCLUDE_DIRS and e != OUTPUT_FILE]
        dirs = [e for e in entries if e.is_dir()]
        files = [e for e in entries if not e.is_dir()]

        for i, d in enumerate(dirs):
            is_last = (i == len(dirs) - 1) and (len(files) == 0)
            connector = "└── " if is_last else "├── "
            sub_prefix = "    " if is_last else "│   "
            lines.append(f"{prefix}{connector}{d.name}/")
            walk(d, prefix + sub_prefix)

        if len(files) <= MAX_FILES_PER_DIR:
            for i, f in enumerate(files):
                is_last = (i == len(files) - 1)
                connector = "└── " if is_last else "├── "
                lines.append(f"{prefix}{connector}{f.name}")
        else:
            half = MAX_FILES_PER_DIR // 2
            for i in range(half):
                f = files[i]
                lines.append(f"{prefix}├── {f.name}")
            hidden = len(files) - MAX_FILES_PER_DIR
            lines.append(f"{prefix}├── ... [{hidden:,} arquivos adicionais omitidos nesta pasta]")
            for i in range(len(files) - half, len(files)):
                f = files[i]
                is_last = (i == len(files) - 1)
                connector = "└── " if is_last else "├── "
                lines.append(f"{prefix}{connector}{f.name}")

    walk(ROOT_DIR)

    print("[3/3] Salvando arquivo...")
    OUTPUT_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"Sucesso! Arquivo gravado em: {OUTPUT_FILE} ({len(lines):,} linhas, {OUTPUT_FILE.stat().st_size:,} bytes)")

if __name__ == "__main__":
    main()
