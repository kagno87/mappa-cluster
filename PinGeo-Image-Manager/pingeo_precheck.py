#!/usr/bin/env python3
# PinGeo - precheck KML immagini My Maps
# Solo verifica: NON salva immagini, NON le converte e NON carica nulla su Cloudflare.

import argparse
import csv
import html
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
ALLOWED_HOSTS = {"mymaps.usercontent.google.com", "lh3.googleusercontent.com"}
TIMEOUT_SECONDS = 25
RETRIES = 2
MAX_IMAGE_BYTES = 25 * 1024 * 1024

# Alcune lettere non vengono convertite in ASCII dalla sola normalizzazione Unicode.
EXTRA_TRANSLITERATION = str.maketrans({
    "ð": "d", "Ð": "D", "ö": "o", "Ö": "O", "ı": "i", "İ": "I",
    "ç": "c", "Ç": "C", "ũ": "u", "Ũ": "U", "ß": "ss", "æ": "ae",
    "Æ": "AE", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L",
})

class ImgParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.srcs = []
    def handle_starttag(self, tag, attrs):
        if tag.lower() == "img":
            for key, value in attrs:
                if key.lower() == "src" and value:
                    self.srcs.append(html.unescape(value.strip()))

def local_text(parent, path):
    node = parent.find(path, KML_NS)
    return (node.text or "").strip() if node is not None and node.text else ""

def extended_data(placemark):
    result = {}
    for data in placemark.findall("./k:ExtendedData/k:Data", KML_NS):
        name = data.attrib.get("name", "").strip()
        value = local_text(data, "k:value")
        if name:
            result[name] = value
    return result

def description_fields(description):
    # Estrae country e size dalla descrizione HTML di My Maps.
    text = re.sub(r"<br\s*/?>", "\n", description, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    fields = {}
    for key in ("country", "size"):
        match = re.search(r"(?:^|\n)\s*" + key + r"\s*:\s*([^\r\n]+)", text, flags=re.I)
        if match:
            fields[key] = match.group(1).strip()
    return fields

def normalize_slug(name):
    value = name.translate(EXTRA_TRANSLITERATION)
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.encode("ascii", "ignore").decode("ascii").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    value = re.sub(r"-{2,}", "-", value)
    return value[:110].rstrip("-") or "pin-senza-nome"

def image_info(data):
    # Riconosce i formati più comuni e legge larghezza/altezza senza librerie esterne.
    if data.startswith(b"\xff\xd8\xff"):
        i, n = 2, len(data)
        while i + 4 <= n:
            if data[i] != 0xFF:
                i += 1
                continue
            while i < n and data[i] == 0xFF:
                i += 1
            if i >= n:
                break
            marker = data[i]
            i += 1
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                continue
            if i + 2 > n:
                break
            seglen = int.from_bytes(data[i:i+2], "big")
            if seglen < 2 or i + seglen > n:
                break
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                          0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                if seglen >= 7:
                    h = int.from_bytes(data[i+3:i+5], "big")
                    w = int.from_bytes(data[i+5:i+7], "big")
                    return "JPEG", w, h
                break
            i += seglen
        return "JPEG", None, None

    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        w = int.from_bytes(data[16:20], "big")
        h = int.from_bytes(data[20:24], "big")
        return "PNG", w, h

    if data.startswith((b"GIF87a", b"GIF89a")) and len(data) >= 10:
        w = int.from_bytes(data[6:8], "little")
        h = int.from_bytes(data[8:10], "little")
        return "GIF", w, h

    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "WEBP", None, None

    return None, None, None

def fetch_image(url):
    last_error = None
    for attempt in range(RETRIES + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; PinGeo-Precheck/1.0)",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            )
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                status = getattr(response, "status", 200)
                content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
                chunks = []
                total = 0
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_IMAGE_BYTES:
                        raise ValueError("immagine oltre il limite di 25 MB")
                    chunks.append(chunk)
                body = b"".join(chunks)
                fmt, width, height = image_info(body)
                if not 200 <= status < 300:
                    raise ValueError(f"HTTP {status}")
                if not fmt:
                    raise ValueError(f"risposta non riconosciuta come immagine (Content-Type: {content_type or 'assente'})")
                return status, content_type, len(body), fmt, width, height, None
        except Exception as exc:
            last_error = str(exc)
            if attempt < RETRIES:
                time.sleep(1.5 * (attempt + 1))
    return None, None, None, None, None, None, last_error

def main():
    parser = argparse.ArgumentParser(
        description="Controlla un KML My Maps per PinGeo senza salvare o caricare immagini."
    )
    parser.add_argument("kml", nargs="?", help="Percorso del file KML")
    args = parser.parse_args()

    if args.kml:
        kml_path = Path(args.kml).expanduser()
    else:
        raw = input("Percorso del file KML (trascina il file qui e premi Invio): ").strip()
        kml_path = Path(raw.strip('"')).expanduser()

    if not kml_path.is_file():
        print(f"ERRORE: file non trovato: {kml_path}")
        return 2

    try:
        root = ET.parse(kml_path).getroot()
    except ET.ParseError as exc:
        print(f"ERRORE XML: {exc}")
        return 2

    placemarks = root.findall(".//k:Placemark", KML_NS)
    if not placemarks:
        print("ERRORE: nessun Placemark trovato.")
        return 2

    rows = []
    filename_owners = {}
    global_errors = []

    print(f"\nPinGeo PRECHECK — {kml_path.name}")
    print(f"Placemark trovati: {len(placemarks)}")
    print("Verifica URL immagini: download temporaneo in memoria, nessun file immagine salvato.\n")

    for index, pm in enumerate(placemarks, 1):
        name = local_text(pm, "k:name")
        description = local_text(pm, "k:description")
        data = extended_data(pm)
        desc_data = description_fields(description)

        issues = []
        warnings = []

        if not name:
            issues.append("nome mancante")

        country = data.get("country", "").strip()
        size = data.get("size", "").strip()
        if not country:
            issues.append("country mancante in ExtendedData")
        if size not in {"1", "2", "3"}:
            issues.append("size mancante o non valido in ExtendedData (ammessi 1, 2, 3)")

        if desc_data.get("country") and country and desc_data["country"] != country:
            issues.append("country diverso tra description ed ExtendedData")
        elif not desc_data.get("country"):
            warnings.append("country non trovato nella description")
        if desc_data.get("size") and size and desc_data["size"] != size:
            issues.append("size diverso tra description ed ExtendedData")
        elif not desc_data.get("size"):
            warnings.append("size non trovato nella description")

        coord_text = local_text(pm, "k:Point/k:coordinates")
        lon = lat = None
        try:
            parts = coord_text.split(",")
            if len(parts) < 2:
                raise ValueError()
            lon, lat = float(parts[0].strip()), float(parts[1].strip())
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError()
        except Exception:
            issues.append("coordinate mancanti o non valide (attese longitudine,latitudine[,altitudine])")

        parser_html = ImgParser()
        parser_html.feed(description)
        description_urls = parser_html.srcs
        gx_url = data.get("gx_media_links", "").strip()

        if not description_urls:
            issues.append("URL immagine assente nella description")
        if not gx_url:
            issues.append("gx_media_links mancante")
        if len(description_urls) > 1:
            warnings.append("più immagini nella description: il precheck considera la prima")
        image_url = description_urls[0] if description_urls else gx_url

        if description_urls and gx_url and description_urls[0] != gx_url:
            issues.append("URL immagine diverso tra description e gx_media_links")

        technical_unverified = False
        if image_url:
            parsed = urlparse(image_url)
            if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
                issues.append(f"host/schema immagine non ammesso: {parsed.scheme}://{parsed.hostname or ''}")
                http_status = content_type = img_format = width = height = byte_count = ""
                fetch_error = "URL non verificato per host non ammesso"
            else:
                http_status, content_type, byte_count, img_format, width, height, fetch_error = fetch_image(image_url)
                if fetch_error:
                    # Un problema DNS/rete/timeout non dimostra che l'URL o il KML siano errati.
                    technical_unverified = True
                    warnings.append("verifica immagine non completata per un problema tecnico: " + fetch_error)
                else:
                    if width is None or height is None:
                        warnings.append("formato riconosciuto, dimensioni non estratte")
                    if width == 0 or height == 0:
                        issues.append("dimensioni immagine non valide")
        else:
            http_status = content_type = img_format = width = height = byte_count = ""
            fetch_error = "URL assente"

        if lon is not None and lat is not None and name:
            slug = normalize_slug(name)
            filename = f"{slug}_{lon:.6f}_{lat:.6f}.jpg"
            previous = filename_owners.get(filename)
            if previous:
                issues.append(f"collisione nome file con Placemark: {previous}")
            else:
                filename_owners[filename] = name
        else:
            filename = ""

        status = "ERRORE" if issues else ("NON VERIFICATO" if technical_unverified else ("ATTENZIONE" if warnings else "OK"))
        rows.append({
            "numero": index,
            "nome": name,
            "paese": country,
            "size": size,
            "longitudine": lon if lon is not None else "",
            "latitudine": lat if lat is not None else "",
            "nome_file_proposto": filename,
            "http_status": http_status,
            "content_type": content_type,
            "formato_rilevato": img_format,
            "larghezza_px": width if width is not None else "",
            "altezza_px": height if height is not None else "",
            "dimensione_byte": byte_count if byte_count is not None else "",
            "esito": status,
            "errori": " | ".join(issues),
            "avvisi": " | ".join(warnings),
            "url_immagine": image_url,
        })

        mark = "✓" if status == "OK" else ("?" if status == "NON VERIFICATO" else ("!" if status == "ATTENZIONE" else "X"))
        print(f"[{mark}] {index}. {name or '(senza nome)'} — {status}")
        if issues:
            for item in issues:
                print(f"    ERRORE: {item}")
        if warnings:
            for item in warnings:
                print(f"    AVVISO: {item}")
        if not fetch_error and img_format:
            print(f"    Immagine: HTTP {http_status}, {img_format}, {width or '?'}x{height or '?'} px, {byte_count:,} byte")
        if filename:
            print(f"    Nome file proposto: {filename}")
        print()

    errors = sum(1 for r in rows if r["esito"] == "ERRORE")
    warnings_count = sum(1 for r in rows if r["esito"] == "ATTENZIONE")
    unverified = sum(1 for r in rows if r["esito"] == "NON VERIFICATO")
    ok = sum(1 for r in rows if r["esito"] == "OK")

    report_path = kml_path.with_name(kml_path.stem + "_precheck.csv")
    with report_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=";")
        writer.writeheader()
        writer.writerows(rows)

    print("=" * 60)
    print(f"RIEPILOGO: {ok} OK | {warnings_count} con avvisi | {unverified} non verificati | {errors} con errori")
    print(f"Rapporto CSV: {report_path}")
    if errors:
        print("ESITO: PRECHECK NON SUPERATO. Correggere gli errori prima di procedere.")
        return 1
    if unverified:
        print("ESITO: VERIFICA INCOMPLETA. Ripetere il precheck da una connessione Internet funzionante.")
        return 2
    if warnings_count:
        print("ESITO: PRECHECK SUPERATO CON AVVISI. Esaminare il CSV prima di procedere.")
        return 0
    print("ESITO: PRECHECK SUPERATO.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
