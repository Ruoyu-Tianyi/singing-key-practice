import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("omr_server", Path(__file__).with_name("omr_server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ExportValidationTests(unittest.TestCase):
    def test_reads_mxl_without_extracting_archive_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "score.mxl"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("META-INF/container.xml", "not the score")
                archive.writestr("score.musicxml", "<score-partwise/>")
            self.assertEqual(server.extract_musicxml(path), b"<score-partwise/>")

    def test_rejects_an_archive_without_musicxml(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "score.mxl"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("META-INF/container.xml", "metadata")
            with self.assertRaises(ValueError):
                server.extract_musicxml(path)


if __name__ == "__main__":
    unittest.main()
