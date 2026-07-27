from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree


NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def extract_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as package:
        xml = package.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    parts: list[str] = []
    for node in root.iter():
        if node.tag == f"{{{NS['w']}}}t" and node.text:
            parts.append(node.text)
        elif node.tag == f"{{{NS['w']}}}tab":
            parts.append("\t")
        elif node.tag == f"{{{NS['w']}}}br":
            parts.append("\n")
    return " ".join(parts)


def extract_pdf(path: Path) -> str:
    try:
        import pypdf
    except Exception:
        return ""
    reader = pypdf.PdfReader(str(path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def main() -> int:
    if len(sys.argv) < 2:
        return 2
    path = Path(sys.argv[1])
    suffix = path.suffix.lower()
    if suffix == ".docx":
        text = extract_docx(path)
    elif suffix == ".pdf":
        text = extract_pdf(path)
    else:
        text = path.read_text(encoding="utf-8", errors="ignore")
    print(re.sub(r"\s+", " ", text).strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
