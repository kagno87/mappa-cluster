
#!/usr/bin/env python3
# PinGeo R2 Sync
# Modalita: inventory (rapida), deep (verifica), sync (sincronizzazione).
# Le modifiche R2 richiedono sempre una conferma esplicita.

import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import html
import io
import json
import mimetypes
import re
import sys
import shutil
import tempfile
import time
import urllib.request
import unicodedata
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, urlsplit

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
ALLOWED_HOSTS = {
    "mymaps.usercontent.google.com",
    "lh3.googleusercontent.com",
}
CATEGORIES = (
    "bianco", "nero", "giallo", "blu", "marrone", "rosso",
    "verde", "viola", "grigio", "turchese", "rosa",
)
TIMEOUT_SECONDS = 30
RETRIES = 2
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_DIMENSION = 800


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


def detect_category(kml_path):
    stem = Path(kml_path).stem.lower().strip()

    for category in CATEGORIES:
        if stem == category:
            return category
        if stem.startswith(category + "-") or stem.startswith(category + "_"):
            return category

    raise ValueError(
        f"Categoria non riconosciuta dal nome KML: {Path(kml_path).name}\n"
        f"Usare uno dei nomi: {', '.join(CATEGORIES)}.\n"
        "Esempio: bianco.kml oppure bianco-test.kml."
    )


def normalize_slug(name):
    extra = str.maketrans({
        "\u00f0": "d", "\u00d0": "D",
        "\u00fe": "th", "\u00de": "Th",
        "\u0131": "i", "\u0130": "I",
        "\u00df": "ss",
        "\u00e6": "ae", "\u00c6": "AE",
        "\u00f8": "o", "\u00d8": "O",
        "\u0142": "l", "\u0141": "L",
    })
    value = name.translate(extra)
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.encode("ascii", "ignore").decode("ascii").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    value = re.sub(r"-{2,}", "-", value)
    return value[:110].rstrip("-") or "pin-senza-nome"


def make_filename(name, lon, lat):
    return f"{normalize_slug(name)}_{lon:.6f}_{lat:.6f}.jpg"


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

        parser = ImgParser()
        parser.feed(description)
        description_urls = parser.srcs
        gx_url = ext.get("gx_media_links", "").strip()

        if description_urls and gx_url and description_urls[0] != gx_url:
            raise ValueError(
                f"Placemark {index} ({name}): URL diversi tra "
                "description e gx_media_links."
            )

        url = description_urls[0] if description_urls else gx_url

        if not name:
            raise ValueError(f"Placemark {index}: nome mancante.")
        if not url:
            raise ValueError(f"Placemark {index} ({name}): URL immagine mancante.")

        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            raise ValueError(
                f"Placemark {index} ({name}): host/schema non ammesso."
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

        records.append({
            "index": index,
            "name": name,
            "lon": lon,
            "lat": lat,
            "coordinates": f"{lat:.6f}, {lon:.6f}",
            "url": url,
            "filename": make_filename(name, lon, lat),
        })

    if not records:
        raise ValueError("Il KML non contiene Placemark.")

    seen = {}
    for rec in records:
        seen.setdefault(rec["filename"], []).append(rec["name"])

    collisions = {key: names for key, names in seen.items() if len(names) > 1}
    if collisions:
        details = "; ".join(
            f"{key}: {', '.join(names)}" for key, names in collisions.items()
        )
        raise ValueError("Collisione nei nomi file generati: " + details)

    return records


def download_image(url):
    last_error = None

    for attempt in range(RETRIES + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; PinGeo-R2-Sync/1.0)",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            )

            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                status = getattr(response, "status", 200)
                if not 200 <= status < 300:
                    raise ValueError(f"HTTP {status}")

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

                return b"".join(chunks)

        except Exception as exc:
            last_error = str(exc)
            if attempt < RETRIES:
                time.sleep(1.5 * (attempt + 1))

    raise RuntimeError(last_error or "download immagine non riuscito")


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


def convert_to_jpeg(raw, target_bytes, min_quality, max_quality):
    try:
        from PIL import Image
    except ImportError:
        raise RuntimeError(
            "Pillow non installato. Esegui: python -m pip install Pillow"
        )

    try:
        source = Image.open(io.BytesIO(raw))
        source_format = (source.format or "SCONOSCIUTO").upper()
        source.load()
    except Exception as exc:
        raise ValueError(f"immagine non leggibile: {exc}")

    if source_format not in {"JPEG", "PNG"}:
        raise ValueError(f"formato originale non previsto: {source_format}")

    width, height = source.size
    if width < 1 or height < 1:
        raise ValueError("dimensioni immagine non valide")

    if source.mode in ("RGBA", "LA") or (
        source.mode == "P" and "transparency" in source.info
    ):
        rgba = source.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    else:
        image = source.convert("RGB")

    # Ridimensiona prima della compressione: lato maggiore massimo 800 px.
    # Le immagini più piccole restano invariate (nessun upscaling).
    current_width, current_height = image.size
    longest_side = max(current_width, current_height)
    if longest_side > MAX_IMAGE_DIMENSION:
        ratio = MAX_IMAGE_DIMENSION / longest_side
        resized_size = (
            max(1, round(current_width * ratio)),
            max(1, round(current_height * ratio)),
        )
        image = image.resize(resized_size, Image.Resampling.LANCZOS)

    width, height = image.size

    low, high = min_quality, max_quality
    best = None

    while low <= high:
        quality = (low + high) // 2
        candidate = jpeg_at_quality(image, quality)

        if len(candidate) <= target_bytes:
            best = candidate
            low = quality + 1
        else:
            high = quality - 1

    if best is not None:
        return best, source_format, width, height

    return (
        jpeg_at_quality(image, min_quality),
        source_format,
        width,
        height,
    )


def prepare_image(rec, target_bytes, min_quality, max_quality):
    raw = download_image(rec["url"])
    jpeg, source_format, width, height = convert_to_jpeg(
        raw, target_bytes, min_quality, max_quality
    )

    return {
        "jpeg": jpeg,
        "sha256": hashlib.sha256(jpeg).hexdigest(),
        "size": len(jpeg),
        "source_format": source_format,
        "width": width,
        "height": height,
    }


def read_config(path):
    cfg = json.loads(path.read_text(encoding="utf-8"))

    required = [
        "account_id", "access_key_id", "secret_access_key",
        "endpoint_url", "bucket_name", "public_url",
    ]
    missing = [key for key in required if not str(cfg.get(key, "")).strip()]

    if missing:
        raise ValueError(
            "Campi mancanti in r2_config.json: " + ", ".join(missing)
        )

    for field in ("endpoint_url", "public_url"):
        parsed = urlsplit(cfg[field])
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError(f"{field} deve essere un URL HTTPS valido")

    if urlsplit(cfg["public_url"]).path not in ("", "/"):
        raise ValueError("public_url deve contenere solo il dominio base")

    return cfg


def make_client(cfg):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=cfg["endpoint_url"].rstrip("/"),
        aws_access_key_id=cfg["access_key_id"],
        aws_secret_access_key=cfg["secret_access_key"],
        region_name="auto",
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )


def list_bucket_objects(client, bucket, prefix):
    objects = {}
    paginator = client.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            key = item["Key"]
            # Ignora eventuali marker di cartella.
            if not key.endswith("/"):
                objects[key] = item

    return objects


def object_hash_from_r2(client, bucket, key, head=None):
    """Calcola sempre l'hash dai byte effettivamente scaricati da R2."""
    response = client.get_object(Bucket=bucket, Key=key)

    try:
        body = response["Body"]
        digest = hashlib.sha256()
        total_bytes = 0

        while True:
            chunk = body.read(64 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            total_bytes += len(chunk)

        if head is not None and head.get("ContentLength") is not None:
            if total_bytes != head["ContentLength"]:
                raise RuntimeError(
                    f"download R2 incompleto per {key}: "
                    f"{total_bytes} byte letti, "
                    f"{head['ContentLength']} attesi"
                )

        return digest.hexdigest(), "HASH_DA_DOWNLOAD_R2", total_bytes

    finally:
        response["Body"].close()


def write_report(path, rows):
    fields = [
        "tipo", "nome", "coordinate", "file",
        "r2_key", "stato", "dettaglio",
        "sha256_kml", "sha256_r2", "byte_kml", "byte_r2",
    ]

    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields, delimiter=";")
        writer.writeheader()
        writer.writerows(rows)


def make_row(rec, key, status, detail):
    return {
        "tipo": "PIN_KML",
        "nome": rec["name"],
        "coordinate": rec["coordinates"],
        "file": rec["filename"],
        "r2_key": key,
        "stato": status,
        "dettaglio": detail,
        "sha256_kml": "",
        "sha256_r2": "",
        "byte_kml": "",
        "byte_r2": "",
    }


def make_stale_row(key, status, detail):
    return {
        "tipo": "OGGETTO_R2",
        "nome": Path(key).stem,
        "coordinate": "",
        "file": Path(key).name,
        "r2_key": key,
        "stato": status,
        "dettaglio": detail,
        "sha256_kml": "",
        "sha256_r2": "",
        "byte_kml": "",
        "byte_r2": "",
    }


def upload_verified(client, bucket, key, prepared):
    """Carica il JPEG e verifica l'hash dei byte riletti direttamente da R2."""
    jpeg = prepared["jpeg"]
    expected_sha256 = prepared["sha256"]

    # Controllo preliminare: i byte in memoria devono corrispondere
    # all'hash prodotto durante la preparazione.
    actual_local_sha256 = hashlib.sha256(jpeg).hexdigest()
    if actual_local_sha256 != expected_sha256:
        raise RuntimeError("SHA-256 del JPEG in memoria non coerente")

    client.upload_fileobj(
        io.BytesIO(jpeg),
        bucket,
        key,
        ExtraArgs={
            "ContentType": "image/jpeg",
            "CacheControl": "public, max-age=31536000, immutable",
            "Metadata": {"sha256": expected_sha256},
        },
    )

    # HEAD controlla dimensione e disponibilità dell'oggetto, ma non prova
    # che il contenuto sia corretto.
    check = client.head_object(Bucket=bucket, Key=key)

    if check.get("ContentLength") != len(jpeg):
        raise RuntimeError(
            "dimensione su R2 diversa dal JPEG preparato "
            f"({check.get('ContentLength')} byte su R2, {len(jpeg)} attesi)"
        )

    # Prova effettiva: scarica l'oggetto appena caricato e ne ricalcola SHA-256.
    remote_sha256, _, remote_size = object_hash_from_r2(
        client, bucket, key, check
    )

    if remote_sha256 != expected_sha256:
        raise RuntimeError(
            "verifica contenuto R2 fallita: "
            f"SHA-256 atteso {expected_sha256}, "
            f"SHA-256 scaricato {remote_sha256}"
        )

    return check


def main():
    parser = argparse.ArgumentParser(
        description="PinGeo R2 Sync — confronto e sincronizzazione KML/R2."
    )

    parser.add_argument("kml", help="Percorso del file KML")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).resolve().parent / "r2_config.json"),
    )
    parser.add_argument("--target-kb", type=float, default=100.0)
    parser.add_argument("--min-quality", type=int, default=30)
    parser.add_argument("--max-quality", type=int, default=95)
    parser.add_argument("--report", default=None)
    parser.add_argument(
        "--mode",
        choices=("deep", "inventory", "sync"),
        default="deep",
        help="deep=verifica; inventory=rapido; sync=modifica R2 dopo conferma",
    )
    parser.add_argument("--workers", type=int, default=4)

    parser.add_argument(
        "--gui-confirm",
        action="store_true",
        help="Richiede conferma grafica prima di modificare R2",
    )
    
    parser.add_argument(
        "--cache-dir",
        default=None,
        help="Cartella cache delle immagini preparate",
    )

    args = parser.parse_args()

    print("\nPinGeo R2 SYNC")

    kml_path = Path(args.kml).expanduser()

    if not kml_path.is_file():
        print(f"ERRORE: KML non trovato: {kml_path}")
        return 2

    if args.target_kb <= 0:
        print("ERRORE: --target-kb deve essere maggiore di zero.")
        return 2

    if not (1 <= args.min_quality <= args.max_quality <= 100):
        print("ERRORE: qualità non valida.")
        return 2

    if not (1 <= args.workers <= 8):
        print("ERRORE: --workers deve essere compreso tra 1 e 8.")
        return 2

    try:
        category = detect_category(kml_path)
        records = extract_records(kml_path)
        cfg = read_config(Path(args.config).expanduser())
        client = make_client(cfg)

    except ImportError as exc:
        print(f"ERRORE: dipendenza mancante: {exc}")
        return 2
    except Exception as exc:
        print(f"ERRORE: {exc}")
        return 2

    bucket = cfg["bucket_name"]
    key_prefix = category + "/"
    report_path = (
        Path(args.report).expanduser()
        if args.report
        else kml_path.with_name(kml_path.stem + "_r2_sync_report.csv")
    )

    cache_dir = (
        Path(args.cache_dir).expanduser()
        if args.cache_dir
        else None
    )

    if cache_dir is not None:
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            print(f"ERRORE: impossibile creare la cache: {exc}")
            return 2

    if args.mode == "sync" and cache_dir is None:
        print("ERRORE: --cache-dir è obbligatorio in modalità sync.")
        return 2

    print(f"Modalità: {args.mode.upper()}")
    print(f"KML: {kml_path.name}")
    print(f"Categoria riconosciuta: {category}")
    print(f"Cartella R2: {key_prefix}")
    print(f"Bucket: {bucket}")
    print(f"Placemark nel KML: {len(records)}")

    try:
        client.head_bucket(Bucket=bucket)
        bucket_objects = list_bucket_objects(client, bucket, key_prefix)

    except Exception as exc:
        print("ERRORE: impossibile leggere il bucket R2.")
        print("Dettaglio:", exc)
        return 3

    print(f"Oggetti attuali in {key_prefix}: {len(bucket_objects)}\n")

    keyed_records = [
        (rec, key_prefix + rec["filename"])
        for rec in records
    ]
    expected_keys = {key for _, key in keyed_records}

    rows = []
    incomplete = False
    counts = {
        "nuovi": 0,
        "sovrascritti": 0,
        "invariati": 0,
        "da_verificare": 0,
        "errori": 0,
        "eliminati": 0,
    }
    analysis = {}

    if args.mode == "inventory":
        print("INVENTARIO RAPIDO: nessun download immagini, nessun hash.\n")

        for rec, key in keyed_records:
            if key in bucket_objects:
                counts["da_verificare"] += 1
                row = make_row(
                    rec, key, "PRESENTE_DA_VERIFICARE",
                    "Chiave presente; contenuto non confrontato",
                )
                print(f"[{rec['index']}/{len(records)}] {rec['name']} — presente")
            else:
                counts["nuovi"] += 1
                row = make_row(
                    rec, key, "NUOVO",
                    "Chiave assente nella cartella R2 della categoria",
                )
                print(f"[{rec['index']}/{len(records)}] {rec['name']} — nuovo")

            rows.append(row)

        stale = sorted(set(bucket_objects) - expected_keys)

        for key in stale:
            rows.append(make_stale_row(
                key, "OBSOLETO_DA_VALUTARE",
                "Oggetto non corrispondente al KML; nessuna eliminazione",
            ))

        print("\nNOTA: INVENTORY non rileva immagini modificate.")

    else:
        print(
            f"VERIFICA APPROFONDITA: {args.workers} connessioni simultanee.\n"
        )

        def inspect(item):
            rec, key = item

            try:
                prepared = prepare_image(
                    rec,
                    int(args.target_kb * 1024),
                    args.min_quality,
                    args.max_quality,
                )
                local_hash = prepared["sha256"]
                existing = bucket_objects.get(key)

                if existing is None:
                    cache_path = None

                    if cache_dir is not None:
                        cache_path = cache_dir / rec["filename"]
                        cache_path.parent.mkdir(
                            parents=True,
                            exist_ok=True,
                        )
                        cache_path.write_bytes(prepared["jpeg"])

                    return {
                        "rec": rec,
                        "key": key,
                        "row": make_row(
                            rec, key, "NUOVO",
                            "Chiave assente; immagine My Maps verificata",
                        ),
                        "category": "nuovi",
                        "hash": local_hash,
                        "cache_path": str(cache_path) if cache_path else None,
                        "message": "NUOVO: oggetto assente da R2.",
                    }

                head = client.head_object(Bucket=bucket, Key=key)
                remote_hash, hash_source, remote_size = object_hash_from_r2(
                    client, bucket, key, head
                )
                diagnostic = {
                    "sha256_kml": local_hash,
                    "sha256_r2": remote_hash,
                    "byte_kml": prepared["size"],
                    "byte_r2": remote_size,
                }

                if remote_hash == local_hash:
                    row = make_row(
                        rec, key, "INVARIATO",
                        f"SHA-256 identico ({hash_source})",
                    )
                    row.update(diagnostic)
                    return {
                        "rec": rec,
                        "key": key,
                        "row": row,
                        "category": "invariati",
                        "hash": local_hash,
                        "diagnostic": diagnostic,
                        "message": "INVARIATO: immagine identica.",
                    }

                cache_path = None

                if cache_dir is not None:
                    cache_path = cache_dir / rec["filename"]
                    cache_path.parent.mkdir(
                        parents=True,
                        exist_ok=True,
                    )
                    cache_path.write_bytes(prepared["jpeg"])

                row = make_row(
                    rec, key, "DA_SOVRASCRIVERE",
                    "SHA-256 diverso; immagine da aggiornare",
                )
                row.update(diagnostic)

                return {
                    "rec": rec,
                    "key": key,
                    "row": row,
                    "category": "sovrascritti",
                    "hash": local_hash,
                    "diagnostic": diagnostic,
                    "cache_path": str(cache_path) if cache_path else None,
                    "message": "MODIFICATO: immagine da sovrascrivere.",
                }
                
            except Exception as exc:
                message = str(exc).replace("\n", " ").strip()
                return {
                    "rec": rec,
                    "key": key,
                    "row": make_row(
                        rec, key, "ERRORE_ANALISI", message
                    ),
                    "category": "errori",
                    "hash": None,
                    "message": "ERRORE: " + message,
                }

        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            for completed, result in enumerate(
                executor.map(inspect, keyed_records), 1
            ):
                analysis[result["key"]] = result
                rows.append(result["row"])
                counts[result["category"]] += 1

                if result["category"] == "errori":
                    incomplete = True

                print(
                    f"[{completed}/{len(records)}] "
                    f"{result['rec']['name']}"
                )
                print("    " + result["message"])
                if result.get("diagnostic"):
                    diag = result["diagnostic"]
                    print("    File R2: " + result["key"])
                    print("    SHA-256 KML: " + diag["sha256_kml"])
                    print("    SHA-256 R2:  " + diag["sha256_r2"])
                    print(f"    Dimensione KML: {diag['byte_kml']} byte")
                    print(f"    Dimensione R2:  {diag['byte_r2']} byte")

        stale = sorted(set(bucket_objects) - expected_keys)

        if incomplete:
            for key in stale:
                rows.append(make_stale_row(
                    key,
                    "NON_CLASSIFICABILE_ANALISI_INCOMPLETA",
                    "Analisi KML non completata; oggetto non eliminabile",
                ))
        else:
            for key in stale:
                rows.append(make_stale_row(
                    key,
                    "OBSOLETO_DA_VALUTARE",
                    "Oggetto non corrispondente ad alcun file del KML",
                ))

        if args.mode == "sync":
            if incomplete:
                print("\nSINCRONIZZAZIONE BLOCCATA.")
                print("Almeno un'immagine non è stata verificata.")
                print("Nessuna modifica a R2 eseguita.")

            else:
                new_items = [
                    result for result in analysis.values()
                    if result["category"] == "nuovi"
                ]
                changed_items = [
                    result for result in analysis.values()
                    if result["category"] == "sovrascritti"
                ]

                print("\n" + "=" * 62)
                print("PIANO DI SINCRONIZZAZIONE")
                print(f"Categoria: {category}/")
                print(f"Nuovi caricamenti: {len(new_items)}")
                print(f"Sovrascritture: {len(changed_items)}")
                print(f"Eliminazioni: {len(stale)}")
                print(f"Immagini invariate: {counts['invariati']}")

                print("\nOggetti da eliminare:")
                if stale:
                    for key in stale:
                        print("  -", key)
                else:
                    print("  Nessuno")

                changes = len(new_items) + len(changed_items) + len(stale)

                if changes == 0:
                    print("\nBucket già sincronizzato. Nessuna modifica necessaria.")

                else:
                    print("\nATTENZIONE: le operazioni modificheranno R2.")
                    print("Le eliminazioni avverranno soltanto dopo")
                    print("il completamento e la verifica di tutti gli upload.")

                    if args.gui_confirm:
                        try:
                            import tkinter as tk
                            from tkinter import messagebox

                            root = tk.Tk()
                            root.withdraw()

                            confirmation = messagebox.askyesno(
                                title="Conferma sincronizzazione PinGeo",
                                message=(
                                    f"Categoria: {category}\n\n"
                                    f"Nuovi caricamenti: {len(new_items)}\n"
                                    f"Sovrascritture: {len(changed_items)}\n"
                                    f"Eliminazioni: {len(stale)}\n\n"
                                    "Vuoi procedere con la sincronizzazione?"
                                ),
                                parent=root,
                            )

                            root.destroy()

                        except Exception as exc:
                            print(
                                "ERRORE: impossibile mostrare "
                                f"la conferma grafica: {exc}"
                            )
                            confirmation = False

                    else:
                        confirmation = input(
                            f"\nPer confermare, scrivi SINCRONIZZA {category}: "
                        ).strip()

                        confirmation = (
                            confirmation == f"SINCRONIZZA {category}"
                        )

                    if confirmation:
                        upload_failed = False

                        print("\nFASE 1 — CARICAMENTO E SOVRASCRITTURA")

                        for result in new_items + changed_items:
                            rec = result["rec"]
                            key = result["key"]

                            print(f"\n[{rec['name']}]")

                            try:
                                cache_path = result.get("cache_path")

                                if not cache_path:
                                    raise RuntimeError(
                                        "file JPEG non presente nella cache"
                                    )

                                cache_file = Path(cache_path)

                                if not cache_file.is_file():
                                    raise RuntimeError(
                                        f"file cache non trovato: {cache_file}"
                                    )

                                jpeg = cache_file.read_bytes()

                                prepared = {
                                    "jpeg": jpeg,
                                    "sha256": hashlib.sha256(jpeg).hexdigest(),
                                    "size": len(jpeg),
                                }

                                if prepared["sha256"] != result["hash"]:
                                    raise RuntimeError(
                                        "immagine My Maps cambiata "
                                        "dopo l'analisi; operazione interrotta"
                                    )

                                upload_verified(
                                    client, bucket, key, prepared
                                )

                                result["row"]["stato"] = (
                                    "CARICATO_VERIFICATO"
                                    if result["category"] == "nuovi"
                                    else "SOVRASCRITTO_VERIFICATO"
                                )
                                result["row"]["dettaglio"] = (
                                    f"Upload verificato: {prepared['size']} byte; "
                                    f"SHA-256 {prepared['sha256']}"
                                )

                                print("  Upload e verifica R2: OK.")

                            except Exception as exc:
                                upload_failed = True
                                result["row"]["stato"] = "ERRORE_UPLOAD"
                                result["row"]["dettaglio"] = str(exc)
                                print("  ERRORE:", exc)

                        if upload_failed:
                            print("\nELIMINAZIONI BLOCCATE.")
                            print(
                                "Almeno un caricamento non è riuscito. "
                                "Nessun oggetto obsoleto sarà eliminato."
                            )

                        else:
                            print("\nFASE 2 — ELIMINAZIONE OGGETTI OBSOLETI")

                            delete_failed = False

                            for key in stale:
                                try:
                                    client.delete_object(
                                        Bucket=bucket, Key=key
                                    )

                                    row = next(
                                        r for r in rows
                                        if r.get("r2_key") == key
                                    )
                                    row["stato"] = "ELIMINATO"
                                    row["dettaglio"] = (
                                        "Oggetto eliminato dopo verifica "
                                        "di tutti gli upload"
                                    )
                                    counts["eliminati"] += 1

                                    print("  ELIMINATO:", key)

                                except Exception as exc:
                                    delete_failed = True
                                    row = next(
                                        r for r in rows
                                        if r.get("r2_key") == key
                                    )
                                    row["stato"] = "ERRORE_ELIMINAZIONE"
                                    row["dettaglio"] = str(exc)
                                    print("  ERRORE:", key, exc)

                            if delete_failed:
                                print(
                                    "\nATTENZIONE: alcune eliminazioni "
                                    "non sono riuscite."
                                )
                            else:
                                print("\nSINCRONIZZAZIONE COMPLETATA.")

                    else:
                        print("\nConferma non riconosciuta.")
                        print("Nessuna modifica a R2 eseguita.")

    try:
        write_report(report_path, rows)
    except Exception as exc:
        print(f"\nERRORE: impossibile scrivere il report CSV: {exc}")
        return 4

    print("\n" + "=" * 62)
    print("RIEPILOGO")
    print(f"Modalità: {args.mode.upper()}")
    print(f"Categoria: {category}/")
    print(f"Placemark KML: {len(records)}")
    print(f"Oggetti attuali R2 nella categoria: {len(bucket_objects)}")
    print(f"Nuovi elementi: {counts['nuovi']}")

    if args.mode != "inventory":
        print(f"Immagini da sovrascrivere: {counts['sovrascritti']}")
        print(f"Elementi invariati: {counts['invariati']}")
        print(f"Errori analisi: {counts['errori']}")
    else:
        print(f"Oggetti presenti da verificare: {counts['da_verificare']}")

    print(f"Oggetti eliminati: {counts['eliminati']}")
    print(f"Oggetti obsoleti rilevati: {len(stale)}")
    print("Report CSV:", report_path.resolve())

    if incomplete:
        print("ESITO: ANALISI INCOMPLETA.")
        return 1

    print("ESITO: OPERAZIONE TERMINATA.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
