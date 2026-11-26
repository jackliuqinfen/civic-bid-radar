"""Read the main document's paragraphs in order without inferring rendered page numbers."""
import json
import sys
import zipfile
from xml.etree import ElementTree

with zipfile.ZipFile(sys.argv[1]) as package:
    document = package.getinfo("word/document.xml")
    if document.file_size > 6 * 1024 * 1024:
        raise ValueError("document limit")
    data = package.read(document)
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise ValueError("invalid document")
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    root = ElementTree.fromstring(data)
    paragraphs = ["".join(node.text or "" for node in paragraph.iter(namespace + "t")) for paragraph in root.iter(namespace + "p")]
    complex_content = any(name.startswith(("word/media/", "word/embeddings/", "word/header", "word/footer")) for name in package.namelist())
    print(json.dumps({"body":"\n".join(paragraphs).strip(),"complex":complex_content},ensure_ascii=False))
