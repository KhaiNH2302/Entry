from email import policy
from email.parser import BytesParser
from pathlib import Path
import html
import re


def decode_part(part):
    payload = part.get_payload(decode=True)
    charset = part.get_content_charset() or "utf-8"
    for candidate in (charset, "utf-8", "windows-1258", "windows-1252"):
        try:
            return payload.decode(candidate)
        except (UnicodeDecodeError, LookupError):
            pass
    return payload.decode("utf-8", errors="replace")


def html_to_text(source):
    source = re.sub(r"(?is)<(script|style).*?>.*?</\1>", "", source)
    source = re.sub(r"(?i)</(p|div|tr|h[1-6]|li)>", "\n", source)
    source = re.sub(r"(?i)<(br|br/)\s*>", "\n", source)
    source = re.sub(r"(?i)</t[dh]>", "\t", source)
    source = re.sub(r"(?s)<[^>]+>", "", source)
    source = html.unescape(source).replace("\xa0", " ")
    source = re.sub(r"[ \t]+\n", "\n", source)
    source = re.sub(r"\n{3,}", "\n\n", source)
    return source.strip()


for path in Path(".").rglob("*.doc"):
    msg = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
    html_parts = [
        decode_part(part)
        for part in msg.walk()
        if part.get_content_type() == "text/html"
    ]
    raw = "\n".join(html_parts)
    out_html = path.with_suffix(".extracted.html")
    out_txt = path.with_suffix(".extracted.txt")
    out_html.write_text(raw, encoding="utf-8")
    out_txt.write_text(html_to_text(raw), encoding="utf-8")
    print(f"extracted {len(raw)} HTML chars")
