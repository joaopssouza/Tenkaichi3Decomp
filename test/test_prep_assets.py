import json
import os
import pathlib
import tempfile
import unittest
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "port/tools"))
import prep_web_assets

class TestPrepWebAssets(unittest.TestCase):
    def test_chunking(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = pathlib.Path(tmpdir)
            fake_iso = tmp_path / "test.iso"
            # Create a 2.5 MiB dummy file
            total_size = int(2.5 * 1024 * 1024)
            fake_iso.write_bytes(b"X" * total_size)

            disc_out = tmp_path / "web" / "disc"
            prep_web_assets.prep_chunks(fake_iso, disc_out)

            self.assertTrue((disc_out / "index.json").exists())
            meta = json.loads((disc_out / "index.json").read_text())
            self.assertEqual(meta["size"], total_size)
            self.assertEqual(meta["piece"], 1024 * 1024)

            # Expect 3 chunks: 1MB, 1MB, 0.5MB
            self.assertTrue((disc_out / "00000.bin").exists())
            self.assertTrue((disc_out / "00001.bin").exists())
            self.assertTrue((disc_out / "00002.bin").exists())

            self.assertEqual((disc_out / "00000.bin").stat().st_size, 1024 * 1024)
            self.assertEqual((disc_out / "00001.bin").stat().st_size, 1024 * 1024)
            self.assertEqual((disc_out / "00002.bin").stat().st_size, 512 * 1024)

if __name__ == "__main__":
    unittest.main()
