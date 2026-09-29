from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.errors import ExtractFailed
from app.parse import next_page_url, parse_html, require_extracted_rows


FIXTURE = (Path(__file__).parent / "fixtures" / "products.html").read_text(encoding="utf-8")
FIELDS = {
    "sku": "td.sku::text",
    "name": "td.nome::text",
    "price": "td.preco::text",
}


class ParseHtmlTest(unittest.TestCase):
    def test_extracts_table_rows(self):
        warnings: list[str] = []
        rows, remaining = parse_html(
            FIXTURE,
            url="https://portal.cliente.com.br/produtos",
            item_selector="tr.produto",
            id_field="sku",
            fields=FIELDS,
            adaptive=False,
            storage_file=None,
            warnings=warnings,
            remaining=100,
        )
        self.assertEqual(remaining, 98)
        self.assertEqual(
            rows,
            [
                {"sku": "SKU-1", "name": "Camisa", "price": "10,00", "external_id": "SKU-1"},
                {"sku": "SKU-2", "name": "Calça", "price": "20,00", "external_id": "SKU-2"},
            ],
        )
        self.assertEqual(warnings, [])

    def test_missing_selector_does_not_invent_rows(self):
        warnings: list[str] = []
        rows, remaining = parse_html(
            FIXTURE,
            url="https://portal.cliente.com.br/produtos",
            item_selector="tr.ausente",
            id_field="sku",
            fields=FIELDS,
            adaptive=False,
            storage_file=None,
            warnings=warnings,
            remaining=100,
        )
        self.assertEqual(rows, [])
        self.assertEqual(remaining, 100)
        self.assertTrue(any("não encontrou itens" in item for item in warnings))
        with self.assertRaises(ExtractFailed):
            require_extracted_rows(rows, warnings, allow_empty=False)
        require_extracted_rows(rows, warnings, allow_empty=True)

    def test_next_page_url_from_fixture(self):
        nxt = next_page_url(
            FIXTURE,
            url="https://portal.cliente.com.br/produtos",
            next_selector="a.next::attr(href)",
            allowed={"portal.cliente.com.br"},
            test_local=True,
            adaptive=False,
            storage_file=None,
        )
        self.assertEqual(nxt, "https://portal.cliente.com.br/produtos?page=2")


if __name__ == "__main__":
    unittest.main()
