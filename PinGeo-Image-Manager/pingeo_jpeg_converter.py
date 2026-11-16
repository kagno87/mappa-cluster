
#!/usr/bin/env python3
# PinGeo - conversione immagini My Maps in JPEG
# Download e conversione paralleli.
# NON carica nulla su Cloudflare e NON modifica il KML originale.

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import html
import io
import re
import sys
import time
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
ALLOWED_HOSTS = {"mymaps.usercontent.google.com", "lh3.googleusercontent.com"}
TIMEOUT_SECONDS = 30
RETRIES = 2
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_DIMENSION = 800
DEFAULT_TARGET_BYTES = 100 * 1024
DEFAULT_WORKERS = 4
MAX_WORKERS = 8

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


def normalize_slug(name):
    value = name.translate(EXTRA_TRANSLITERATION)
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.encode("ascii", "ignore").decode("ascii").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    value = re.sub(r"-{2,}", "-", value)
    return value[:110].rstrip("-") or "pin-senza-nome"


def download(url):
    last_error = None

    for attempt in range(RETRIES + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; PinGeo-Image-Converter/1.0)",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            )

            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                status = getattr(response, "status", 200)

                if not 200 <= status < 300:
                    raise ValueError(f"HTTP {status}")

                chunks, total = [], 0

                while True:
                    chunk = response.read(64 * 1024)

                    if not chunk:
                        break

                    total += len(chunk)

                    if total > MAX_IMAGE_BYTES:
                        raise ValueError("immagine oltre il limite di 25 MB")

                    chunks.append(chunk)

                return b"".join(chunks)

        except Exception as exc:
            last_error = str(exc)

            if attempt < RETRIES:
                time.sleep(1.5 * (attempt + 1))

    raise RuntimeError(last_error or "download non riuscito")


def extract_records(kml_path):
    root = ET.parse(kml_path).getroot()
    placemarks = root.findall(".//k:Placemark", KML_NS)
    records = []

    for index, pm in enumerate(placemarks, 1):
        name = local_text(pm, "k:name")
        description = local_text(pm, "k:description")
        ext = {}

        for item in pm.findall("./k:ExtendedData/k:Data", KML_NS):
            key = item.attrib.get("name", "").strip()
            value = local_text(item, "k:value")

            if key:
                ext[key] = value

        img_parser = ImgParser()
        img_parser.feed(description)
        description_urls = img_parser.srcs
        gx_url = ext.get("gx_media_links", "").strip()

        if description_urls and gx_url and description_urls[0] != gx_url:
            raise ValueError(
                f"Placemark {index} ({name}): URL diversi tra description e gx_media_links."
            )

        url = description_urls[0] if description_urls else gx_url

        if not name:
            raise ValueError(f"Placemark {index}: nome mancante.")

        if not url:
            raise ValueError(f"Placemark {index} ({name}): URL immagine mancante.")

        parsed = urlparse(url)

        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            raise ValueError(
                f"Placemark {index} ({name}): host/schema non ammesso "
                f"({parsed.scheme}://{parsed.hostname or ''})."
            )

        coord_text = local_text(pm, "k:Point/k:coordinates")

        try:
            parts = coord_text.split(",")
            lon, lat = float(parts[0].strip()), float(parts[1].strip())

            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError()

        except Exception:
            raise ValueError(
                f"Placemark {index} ({name}): coordinate mancanti o non valide."
            )

        filename = f"{normalize_slug(name)}_{lon:.6f}_{lat:.6f}.jpg"

        records.append({
            "index": index,
            "name": name,
            "url": url,
            "filename": filename,
        })

    if not records:
        raise ValueError("Il KML non contiene Placemark.")

    return records


def jpeg_at_quality(image, quality):
    buffer = io.BytesIO()

    image.save(
        buffer,
        format="JPEG",
        quality=quality,
        optimize=True,
        progressive=False,
        subsampling=0,
    )

    return buffer.getvalue()


def convert_image(raw, target_bytes, min_quality, max_quality):
    try:
        from PIL import Image
    except ImportError:
        raise RuntimeError(
            "Libreria Pillow non installata. Esegui: python -m pip install Pillow"
        )

    try:
        source = Image.open(io.BytesIO(raw))
        source_format = (source.format or "SCONOSCIUTO").upper()
        source.load()

    except Exception as exc:
        raise ValueError(f"contenuto scaricato non leggibile come immagine: {exc}")

    if source_format not in {"JPEG", "PNG"}:
        raise ValueError(f"formato originale non previsto: {source_format}")

    width, height = source.size

    if width < 1 or height < 1:
        raise ValueError("dimensioni immagine non valide")

    # JPEG non supporta la trasparenza:
    # eventuali aree trasparenti vengono appiattite su bianco.
    if source.mode in ("RGBA", "LA") or (
        source.mode == "P" and "transparency" in source.info
    ):
        rgba = source.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background

    else:
        image = source.convert("RGB")

    # Ridimensionamento proporzionale:
    # lato maggiore massimo 800 px, senza ingrandimenti.
    current_width, current_height = image.size
    longest_side = max(current_width, current_height)

    if longest_side > MAX_IMAGE_DIMENSION:
        ratio = MAX_IMAGE_DIMENSION / longest_side

        resized_size = (
            max(1, round(current_width * ratio)),
            max(1, round(current_height * ratio)),
        )

        image = image.resize(
            resized_size,
            Image.Resampling.LANCZOS,
        )

    width, height = image.size

    # Ricerca binaria della qualità JPEG più alta
    # che rispetta il target di peso.
    low, high = min_quality, max_quality
    best = None
    best_quality = None

    while low <= high:
        quality = (low + high) // 2
        candidate = jpeg_at_quality(image, quality)

        if len(candidate) <= target_bytes:
            best = candidate
            best_quality = quality
            low = quality + 1

        else:
            high = quality - 1

    if best is not None:
        return best, source_format, width, height, best_quality, True

    # Se neppure la qualità minima raggiunge il target,
    # conserva comunque la versione meno pesante consentita.
    fallback = jpeg_at_quality(image, min_quality)

    return fallback, source_format, width, height, min_quality, False


def process_record(record, output_dir, target_bytes, min_quality, max_quality, overwrite):
    """Scarica e converte una singola immagine; eseguita in un worker."""

    name, filename = record["name"], record["filename"]
    destination = output_dir / filename
    log = [f"[{record['index']}] {name}"]

    if destination.exists() and not overwrite:
        message = "file già esistente; usare --overwrite per sostituirlo"
        log.append(f"    ERRORE: {message}")

        return {
            "nome": name,
            "file": filename,
            "esito": "ERRORE",
            "errore": message,
        }, log, False

    try:
        # Download e conversione avvengono entrambi nel worker.
        raw = download(record["url"])

        jpeg, source_format, width, height, quality, target_met = convert_image(
            raw,
            target_bytes,
            min_quality,
            max_quality,
        )

        # Verifica il JPEG prodotto prima di scriverlo su disco.
        from PIL import Image

        with Image.open(io.BytesIO(jpeg)) as check:
            if check.format != "JPEG" or check.size != (width, height):
                raise ValueError(
                    "verifica finale JPEG fallita (formato o dimensioni diversi)"
                )

        temp_path = destination.with_suffix(destination.suffix + ".tmp")
        temp_path.write_bytes(jpeg)
        temp_path.replace(destination)

        result = "OK" if target_met else "SOPRA TARGET"

        log.append(
            f"    Originale: {source_format}, {len(raw):,} byte"
        )

        log.append(
            f"    JPEG finale: {width}x{height} px, qualità {quality}, "
            f"{len(jpeg):,} byte ({len(jpeg)/1024:.1f} KB)"
        )

        log.append(f"    File: {destination}")

        if not target_met:
            log.append(
                f"    AVVISO: target non raggiunto nemmeno a qualità {min_quality}."
            )

        report = {
            "nome": name,
            "file": filename,
            "formato_originale": source_format,
            "larghezza_finale_px": width,
            "altezza_finale_px": height,
            "peso_originale_byte": len(raw),
            "qualita_jpeg": quality,
            "peso_jpeg_byte": len(jpeg),
            "target_kb": target_bytes / 1024,
            "target_raggiunto": "SI" if target_met else "NO",
            "esito": result,
            "errore": "",
        }

        return report, log, True

    except Exception as exc:
        log.append(f"    ERRORE: {exc}")

        return {
            "nome": name,
            "file": filename,
            "esito": "ERRORE",
            "errore": str(exc),
        }, log, False


def main():
    parser = argparse.ArgumentParser(
        description="Converte le immagini My Maps di un KML in JPEG locali, senza upload."
    )

    parser.add_argument("kml", help="Percorso del file KML")

    parser.add_argument(
        "--target-kb",
        type=float,
        default=100.0,
        help="Peso obiettivo per immagine in KB (default: 100)",
    )

    parser.add_argument(
        "--min-quality",
        type=int,
        default=30,
        help="Qualità JPEG minima (default: 30)",
    )

    parser.add_argument(
        "--max-quality",
        type=int,
        default=95,
        help="Qualità JPEG massima (default: 95)",
    )

    parser.add_argument(
        "--output-dir",
        default=None,
        help="Cartella di output (default: <nome-kml>_jpeg)",
    )

    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Consente di sovrascrivere JPEG già presenti",
    )

    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"Numero di elaborazioni parallele (default: {DEFAULT_WORKERS}, massimo: {MAX_WORKERS})",
    )

    args = parser.parse_args()

    kml_path = Path(args.kml).expanduser()

    if not kml_path.is_file():
        print(f"ERRORE: file non trovato: {kml_path}")
        return 2

    if args.target_kb <= 0:
        print("ERRORE: --target-kb deve essere maggiore di zero.")
        return 2

    if not (1 <= args.min_quality <= args.max_quality <= 100):
        print("ERRORE: qualità non valida; usare valori tra 1 e 100.")
        return 2

    if not (1 <= args.workers <= MAX_WORKERS):
        print(f"ERRORE: --workers deve essere compreso tra 1 e {MAX_WORKERS}.")
        return 2

    try:
        records = extract_records(kml_path)

    except Exception as exc:
        print(f"ERRORE KML: {exc}")
        return 2

    # Evita che due worker scrivano contemporaneamente lo stesso file.
    filenames = [record["filename"] for record in records]

    if len(filenames) != len(set(filenames)):
        print("ERRORE: il KML genera nomi file duplicati; conversione annullata.")
        return 2

    output_dir = (
        Path(args.output_dir)
        if args.output_dir
        else kml_path.with_name(kml_path.stem + "_jpeg")
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    target_bytes = int(args.target_kb * 1024)

    print(f"\nPinGeo JPEG CONVERTER — {kml_path.name}")
    print(f"Pin trovati: {len(records)}")
    print(f"Target: {args.target_kb:g} KB per immagine")
    print(f"Lato maggiore massimo: {MAX_IMAGE_DIMENSION} px")
    print(f"Elaborazioni parallele: {args.workers} worker")
    print("Download e conversione JPEG vengono eseguiti in parallelo.")
    print("Nessun upscaling; nessun upload su Cloudflare.\n")

    report = []
    successes = 0

    # Ogni worker esegue download + resize + compressione + salvataggio.
    with ThreadPoolExecutor(
        max_workers=args.workers,
        thread_name_prefix="pingeo",
    ) as executor:

        futures = {
            executor.submit(
                process_record,
                record,
                output_dir,
                target_bytes,
                args.min_quality,
                args.max_quality,
                args.overwrite,
            ): record
            for record in records
        }

        completed = 0

        for future in as_completed(futures):
            completed += 1
            record = futures[future]

            try:
                row, log, success = future.result()

            except Exception as exc:
                row = {
                    "nome": record["name"],
                    "file": record["filename"],
                    "esito": "ERRORE",
                    "errore": f"errore imprevisto nel worker: {exc}",
                }

                log = [
                    f"[{record['index']}] {record['name']}",
                    f"    ERRORE: {exc}",
                ]

                success = False

            print(f"\n[{completed}/{len(records)} completate]")

            for line in log:
                print(line)

            report.append(row)

            if success:
                successes += 1

    # Ripristina nel report l'ordine originale dei Placemark.
    report.sort(
        key=lambda row: next(
            (
                rec["index"]
                for rec in records
                if rec["filename"] == row.get("file")
            ),
            10**9,
        )
    )

    report_path = output_dir / "conversion_report.csv"
    fields = sorted({key for row in report for key in row.keys()})

    with report_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=fields,
            delimiter=";",
        )

        writer.writeheader()
        writer.writerows(report)

    failures = len(records) - successes

    print("\n" + "=" * 60)

    print(
        f"RIEPILOGO: {successes}/{len(records)} "
        f"conversioni completate; {failures} errori"
    )

    print(f"Worker utilizzati: {args.workers}")
    print(f"Cartella JPEG: {output_dir.resolve()}")
    print(f"Rapporto: {report_path.resolve()}")

    if failures:
        print("ESITO: CONVERSIONE INCOMPLETA.")
        return 1

    print("ESITO: CONVERSIONE COMPLETATA. Controllare i JPEG prima di procedere.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
