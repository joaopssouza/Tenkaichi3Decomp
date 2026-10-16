"""Tests of tagteam_ledger.py: python3 -m unittest port/tools/test_tagteam_ledger.py"""
import os, sys, tempfile, textwrap, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tagteam_ledger as L  # noqa: E402

SYMBOLS = textwrap.dedent("""\
    // a comment line
    Battle_ResetWork = 0x00126F18; // type:func // guess
    Battle_Load = 0x00127068; // type:func // guess
    Battle_Unload = 0x001270E8; // type:func
    gBattleWork = 0x002FEB00; // a variable, no type
    """)

MAIN_YAML = textwrap.dedent("""\
    segments:
      - name: cod
        type: code
        start: 0x000000
        vram: 0x00100000
        subsegments:
          - [0x000258, c, main]
          - [0x026F00, c, battle/battle_work]
          - [0x1C3400, data, cod/1C3400] # .data
          - { type: bss, vram: 0x002FF300, name: cod/002FF300 } # .bss
    """)

OVERLAY_YAML = textwrap.dedent("""\
    segments:
      - name: DBZP
        type: code
        start: 0x000000
        vram: 0x00334C00
        subsegments:
          - [0x000000, c, menu/menu_a]
    """)


class Fixture(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        def put(name, text):
            p = os.path.join(d, name)
            with open(p, "w") as f:
                f.write(text)
            return p
        self.symbols = L.load_symbols([put("battle.txt", SYMBOLS)])
        self.segments = L.load_segments([put("main.yaml", MAIN_YAML), put("dbzp.yaml", OVERLAY_YAML)])
        self.mod = put("mod.py", "HOOK = A(0x1C2A28)\nX = foo(A(0x100798))\n")

    def test_symbols_are_sorted_with_their_kind(self):
        self.assertEqual(self.symbols[0], (0x00126F18, "Battle_ResetWork", True))
        self.assertEqual(self.symbols[-1], (0x002FEB00, "gBattleWork", False))

    def test_segments_give_vram_start_and_file(self):
        self.assertIn((0x100258, "main", "c"), self.segments)
        self.assertIn((0x2FF300, "cod/002FF300", "bss"), self.segments)
        self.assertIn((0x334C00, "menu/menu_a", "c"), self.segments)

    def test_exact_function(self):
        r = L.resolve(0x00127068, self.symbols, self.segments)
        self.assertEqual((r["kind"], r["symbol"], r["offset"], r["file"]), ("exact", "Battle_Load", 0, "battle/battle_work"))

    def test_inside_function(self):
        r = L.resolve(0x00127070, self.symbols, self.segments)
        self.assertEqual((r["kind"], r["symbol"], r["offset"]), ("inside", "Battle_Load", 8))

    def test_data_address_near_a_variable(self):
        r = L.resolve(0x002FEB14, self.symbols, self.segments)
        self.assertEqual((r["kind"], r["symbol"], r["offset"]), ("inside", "gBattleWork", 0x14))

    def test_code_address_never_lands_on_a_variable(self):
        # 0x2FEB00 is a variable; a code address after the last function stays with the function
        r = L.resolve(0x00127100, self.symbols, self.segments)
        self.assertEqual(r["symbol"], "Battle_Unload")

    def test_mod_memory(self):
        r = L.resolve(0x07368000, self.symbols, self.segments)
        self.assertEqual((r["kind"], r["symbol"]), ("mod-memory", None))

    def test_overlay_address_has_no_main_symbol(self):
        r = L.resolve(0x00335000, self.symbols, self.segments)
        self.assertEqual((r["kind"], r["symbol"], r["file"]), ("unknown", None, "menu/menu_a"))

    def test_scan_module(self):
        got = L.scan_module(self.mod)
        self.assertEqual(got, [
            {"name": "HOOK", "addr": 0x1C2A28, "line": 1, "role": "hook"},
            {"name": None, "addr": 0x100798, "line": 2, "role": "ref"},
        ])


if __name__ == "__main__":
    unittest.main()
