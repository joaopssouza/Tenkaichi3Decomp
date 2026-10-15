import pathlib

root = pathlib.Path(__file__).resolve().parents[1]
shell_path = root / "port/web/shell.html"
runtime_path1 = root / "port/web/runtime.html"
runtime_path2 = root / "port/build/web/runtime.html"

content = shell_path.read_text(encoding="utf-8")

# 1. Add BT3_HD_TEXTURES to preRun ENV
content = content.replace(
    "BT3_TEXTURES: '/textures' },",
    "BT3_TEXTURES: '/textures', BT3_HD_TEXTURES: Q.get('hd') || '0' },"
)

# 2. Add movie bypass in start(disc)
movie_bypass = """
      // Movie bypass optimization: inject stub buffer for opening video
      if (ENV.BT3_NOMOVIE === '1' || Q.get('net') || !Q.get('movie')) {
        ENV.BT3_NOMOVIE = '1';
        try {
          const dummy = new Uint8Array(4 * 0x80000);
          FS.mkdirTree('/disc/DATA');
          FS.writeFile('/disc/DATA/ZS3USOP.PSS', dummy);
          FS.writeFile('/disc/DATA/ZS3USED.PSS', dummy);
          Module.keep('Opening video PSS stubbed');
        } catch (e) {}
      }
"""
anchor = "say(`Disc recognised (${n.toLocaleString()} archive entries). Starting…`);"
content = content.replace(anchor, anchor + movie_bypass)

# 3. Conditional HD Texture indexing (default 0 = skip, 1 = UI only, 2 = all)
old_tex_anchor = """      try {
        const tr = await fetch('/textures_index.json');
        if (tr.ok) {
          const list = await tr.json();
          FS.mkdirTree('/textures/SLUS-21678');
          for (const rel of list) {
            const p = '/textures/SLUS-21678/' + rel;
            const dir = p.slice(0, p.lastIndexOf('/'));
            FS.mkdirTree(dir);
            FS.writeFile(p, new Uint8Array(0));
          }
          try { FS.symlink('/textures', 'textures'); } catch (e) {}
          try { FS.symlink('/textures', '/home/web_user/textures'); } catch (e) {}
          Module.keep(`Indexed ${list.length} textures for on-demand HD replacement`);
        }
      } catch (err) { Module.keep('texture index: ' + err); }"""

new_tex_code = """      const hdMode = Q.get('hd') || '0';
      if (hdMode !== '0') {
        try {
          const tr = await fetch('/textures_index.json');
          if (tr.ok) {
            let list = await tr.json();
            if (hdMode === '1') {
              list = list.filter(p => p.includes('Buttons/') || p.includes('Others/Text/') || p.includes('/Text/'));
            }
            FS.mkdirTree('/textures/SLUS-21678');
            for (const rel of list) {
              const p = '/textures/SLUS-21678/' + rel;
              const dir = p.slice(0, p.lastIndexOf('/'));
              FS.mkdirTree(dir);
              FS.writeFile(p, new Uint8Array(0));
            }
            try { FS.symlink('/textures', 'textures'); } catch (e) {}
            try { FS.symlink('/textures', '/home/web_user/textures'); } catch (e) {}
            Module.keep(`Indexed ${list.length} textures for on-demand HD replacement (tier ${hdMode})`);
          }
        } catch (err) { Module.keep('texture index: ' + err); }
      } else {
        Module.keep('HD textures disabled (Original PS2 mode): 0 textures indexed');
      }"""

content = content.replace(old_tex_anchor, new_tex_code)

runtime_path1.write_text(content, encoding="utf-8")
runtime_path2.write_text(content, encoding="utf-8")
print(f"Generated {runtime_path1} and {runtime_path2} successfully ({len(content)} chars)")
