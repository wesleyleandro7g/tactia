from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi import HTTPException

from app import main as ingest_main


class StorageFileTest(unittest.TestCase):
    def test_qualifies_sqlite_with_resource_key(self):
        ingest_main.ADAPTIVE_DIR = Path(tempfile.mkdtemp())
        products = ingest_main._storage_file("tenant1", "source1", "products")
        catalog = ingest_main._storage_file("tenant1", "source1", "catalog.items")
        self.assertNotEqual(products, catalog)
        self.assertTrue(products.name.endswith("source1__products.sqlite"))
        self.assertTrue(catalog.name.endswith("source1__catalog_items.sqlite"))

    def test_rejects_path_escape_in_resource_key(self):
        ingest_main.ADAPTIVE_DIR = Path(tempfile.mkdtemp())
        with self.assertRaises(HTTPException):
            ingest_main._storage_file("tenant1", "source1", "..")


if __name__ == "__main__":
    unittest.main()
