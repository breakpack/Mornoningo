from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable
from zipfile import ZipFile

from pypdf import PdfReader


def normalize_text(text: str) -> str:
    cleaned = (text or "").replace("\x00", " ")
    cleaned = re.sub(r"\r+", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def extract_text_from_pdf(file_path: Path) -> str:
    reader = PdfReader(str(file_path))
    parts = []
    for page in reader.pages:
        try:
            page_text = page.extract_text() or ""
        except Exception:  # pragma: no cover - best effort extraction
            page_text = ""
        parts.append(page_text)
    return normalize_text("\n".join(parts))


def extract_text_from_pptx(file_path: Path) -> str:
    parts = []
    with ZipFile(file_path) as archive:
        slide_files = sorted(
            name
            for name in archive.namelist()
            if name.startswith("ppt/slides/slide") and name.endswith(".xml")
        )
        for name in slide_files:
            xml_bytes = archive.read(name)
            parts.extend(_extract_text_nodes(xml_bytes.decode("utf-8", errors="ignore")))
    return normalize_text("\n".join(parts))


def _extract_text_nodes(xml_text: str) -> Iterable[str]:
    pattern = re.compile(r"<a:t[^>]*>(.*?)</a:t>", re.DOTALL)
    for match in pattern.finditer(xml_text):
        fragment = match.group(1)
        fragment = (
            fragment.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            .replace("&apos;", "'")
        )
        yield fragment
