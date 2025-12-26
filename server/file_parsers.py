from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, Iterable, List
from zipfile import ZipFile

from pypdf import PdfReader


def normalize_text(text: str) -> str:
    cleaned = (text or "").replace("\x00", " ")
    cleaned = re.sub(r"\r+", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def extract_text_from_pdf(file_path: Path) -> str:
    pages = extract_pdf_pages(file_path)
    return normalize_text("\n".join(page["text"] for page in pages))


def extract_text_from_pptx(file_path: Path) -> str:
    slides = extract_pptx_slides(file_path)
    return normalize_text("\n".join(slide["text"] for slide in slides))


def extract_pdf_pages(file_path: Path) -> List[Dict[str, str]]:
    reader = PdfReader(str(file_path))
    pages: List[Dict[str, str]] = []
    for idx, page in enumerate(reader.pages, start=1):
        try:
            page_text = page.extract_text() or ""
        except Exception:  # pragma: no cover - best effort extraction
            page_text = ""
        normalized = normalize_text(page_text)
        pages.append({"index": idx, "label": f"Page {idx}", "text": normalized})
    return pages


def extract_pptx_slides(file_path: Path) -> List[Dict[str, str]]:
    slides: List[Dict[str, str]] = []
    with ZipFile(file_path) as archive:
        slide_files = sorted(
            name
            for name in archive.namelist()
            if name.startswith("ppt/slides/slide") and name.endswith(".xml")
        )
        for idx, name in enumerate(slide_files, start=1):
            xml_bytes = archive.read(name)
            text_nodes = list(_extract_text_nodes(xml_bytes.decode("utf-8", errors="ignore")))
            normalized = normalize_text("\n".join(text_nodes))
            slides.append({"index": idx, "label": f"Slide {idx}", "text": normalized})
    return slides


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
