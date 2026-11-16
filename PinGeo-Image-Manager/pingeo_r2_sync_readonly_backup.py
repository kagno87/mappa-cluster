#!/usr/bin/env python3
# PinGeo R2 Sync - ANALISI SOLTANTO.
# Confronta direttamente un KML con gli oggetti Cloudflare R2.
# Non carica, sovrascrive o elimina alcun oggetto R2.

import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import html
import io
import json
import re
import sys
import time
import urllib.request
import unicodedata
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}
ALLOWED_HOSTS = {"mymaps.usercontent.google.com", "lh3.googleusercontent.com"}
TIMEOUT_SECONDS = 30
RETRIES = 2
MAX_IMAGE_BYTES = 25 * 1024 * 1024


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
    extra = str.maketrans({
        "ð": "d", "Ð": "D", "ö": "o", "Ö": "O", "ı": "i", "İ": "I",
        "ç": "c", "Ç": "C", "ũ": "u", "Ũ": "U", "ß": "ss", "æ": "ae",
        "Æ": "AE", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L",
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
    raise RuntimeError(last_error or "download immagine non riuscito")


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

    if source.mode in ("RGBA", "LA") or (
        source.mode == "P" and "transparency" in source.info
    ):
        rgba = source.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    else:
        image = source.convert("RGB")

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
    return jpeg_at_quality(image, min_quality), source_format, width, height


def read_config(path):
    cfg = json.loads(path.read_text(encoding="utf-8"))
    required = [
        "account_id", "access_key_id", "secret_access_key",
        "endpoint_url", "bucket_name", "public_url",
    ]
    missing = [key for key in required if not str(cfg.get(key, "")).strip()]
    if missing:
        raise ValueError("Campi mancanti in r2_config.json: " + ", ".join(missing))
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


def object_hash_from_r2(client, bucket, key, head):
    metadata_hash = head.get("Metadata", {}).get("sha256", "").strip().lower()
    if metadata_hash:
        return metadata_hash, "METADATO_SHA256"

    response = client.get_object(Bucket=bucket, Key=key)
    try:
        body = response["Body"]
        digest = hashlib.sha256()
        while True:
            chunk = body.read(64 * 1024)
            if not chunk:
                break
            digest.update(chunk)
        return digest.hexdigest(), "HASH_DA_DOWNLOAD_R2"
    finally:
        response["Body"].close()


def list_bucket_objects(client, bucket, prefix):
    objects = {}
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            objects[item["Key"]] = item
    return objects


def write_report(path, rows):
    fields = ["tipo", "nome", "coordinate", "file", "r2_key", "stato", "dettaglio"]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields, delimiter=";")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(
        description="Confronta un KML con Cloudflare R2 senza modificare il bucket."
    )
    parser.add_argument("kml", help="Percorso del file KML da analizzare")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).resolve().parent / "r2_config.json"),
    )
    parser.add_argument("--prefix", default="", help="Prefisso R2 opzionale, es. bianco/")
    parser.add_argument("--target-kb", type=float, default=100.0)
    parser.add_argument("--min-quality", type=int, default=30)
    parser.add_argument("--max-quality", type=int, default=95)
    parser.add_argument("--report", default=None, help="Percorso CSV del report")
    parser.add_argument(
        "--mode",
        choices=("deep", "inventory"),
        default="deep",
        help="deep confronta anche le immagini; inventory controlla solo le chiavi",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Download/confronti simultanei in modalità deep (default: 4)",
    )
    args = parser.parse_args()

    print("\nPinGeo R2 SYNC — ANALISI SOLTANTO")
    print(
        "Modalità:",
        "VERIFICA APPROFONDITA" if args.mode == "deep" else "INVENTARIO RAPIDO",
    )
    print("Nessuna operazione di scrittura o cancellazione su R2.\n")

    kml_path = Path(args.kml).expanduser()
    if not kml_path.is_file():
        print(f"ERRORE: file KML non trovato: {kml_path}")
        return 2
    if args.target_kb <= 0:
        print("ERRORE: --target-kb deve essere maggiore di zero.")
        return 2
    if not (1 <= args.min_quality <= args.max_quality <= 100):
        print("ERRORE: qualità non valida; usare valori tra 1 e 100.")
        return 2
    if not (1 <= args.workers <= 8):
        print("ERRORE: --workers deve essere compreso tra 1 e 8.")
        return 2

    try:
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
    prefix = args.prefix.strip("/")
    key_prefix = prefix + "/" if prefix else ""
    report_path = (
        Path(args.report).expanduser()
        if args.report
        else kml_path.with_name(kml_path.stem + "_r2_sync_report.csv")
    )

    print(f"KML: {kml_path.name}")
    print(f"Bucket: {bucket}")
    print(f"Prefisso: {key_prefix or '(radice bucket)'}")
    print(f"Placemark nel KML: {len(records)}")

    try:
        client.head_bucket(Bucket=bucket)
        bucket_objects = list_bucket_objects(client, bucket, key_prefix)
    except Exception as exc:
        print("ERRORE: impossibile leggere il bucket R2.")
        print("Dettaglio:", exc)
        return 3

    print(f"Oggetti attuali nel bucket/prefisso: {len(bucket_objects)}")
    print()

    rows = []
    expected_keys = set()
    counts = {
        "invariati": 0,
        "nuovi": 0,
        "sovrascritti": 0,
        "da_verificare": 0,
        "errori": 0,
    }
    incomplete = False
    target_bytes = int(args.target_kb * 1024)

    # Costruiamo prima la mappa KML -> chiave R2.
    keyed_records = []
    for rec in records:
        key = key_prefix + rec["filename"]
        expected_keys.add(key)
        keyed_records.append((rec, key))

    if args.mode == "inventory":
        # Modalità veloce: una sola enumerazione paginata del bucket.
        # Nessun download di immagini, HEAD o GET di singoli oggetti.
        print("Inventario rapido: nessun download di immagini e nessuna verifica hash.\n")
        for rec, key in keyed_records:
            if key in bucket_objects:
                status = "PRESENTE_DA_VERIFICARE"
                detail = "Chiave presente in R2; contenuto non confrontato"
                counts["da_verificare"] += 1
                print(
                    f"[{rec['index']}/{len(records)}] {rec['name']} — presente, "
                    "verifica hash non eseguita"
                )
            else:
                status = "NUOVO"
                detail = "Chiave assente da R2"
                counts["nuovi"] += 1
                print(f"[{rec['index']}/{len(records)}] {rec['name']} — nuovo")

            rows.append({
                "tipo": "PIN_KML",
                "nome": rec["name"],
                "coordinate": rec["coordinates"],
                "file": rec["filename"],
                "r2_key": key,
                "stato": status,
                "dettaglio": detail,
            })

    else:
        print(
            f"Verifica approfondita: download e confronti in parallelo "
            f"({args.workers} connessioni simultanee).\n"
        )

        def inspect_record(item):
            rec, key = item
            try:
                raw = download_image(rec["url"])
                jpeg, source_format, width, height = convert_to_jpeg(
                    raw, target_bytes, args.min_quality, args.max_quality
                )
                local_hash = hashlib.sha256(jpeg).hexdigest()
                existing = bucket_objects.get(key)

                if existing is None:
                    return rec, {
                        "tipo": "PIN_KML",
                        "nome": rec["name"],
                        "coordinate": rec["coordinates"],
                        "file": rec["filename"],
                        "r2_key": key,
                        "stato": "NUOVO",
                        "dettaglio": (
                            f"Chiave assente da R2; immagine My Maps verificata "
                            f"({source_format}, {width}x{height})"
                        ),
                    }, "nuovi", "NUOVO: oggetto assente da R2."

                head = client.head_object(Bucket=bucket, Key=key)
                remote_hash, hash_source = object_hash_from_r2(
                    client, bucket, key, head
                )
                remote_size = head.get("ContentLength", "")

                if remote_hash == local_hash:
                    status = "INVARIATO"
                    detail = f"SHA-256 identico; confronto tramite {hash_source}"
                    category = "invariati"
                    message = "INVARIATO: immagine identica."
                else:
                    status = "DA_SOVRASCRIVERE"
                    detail = (
                        f"SHA-256 diverso; R2={remote_size} byte, "
                        f"nuovo JPEG={len(jpeg)} byte"
                    )
                    category = "sovrascritti"
                    message = "MODIFICATO: immagine diversa, da sovrascrivere."

                return rec, {
                    "tipo": "PIN_KML",
                    "nome": rec["name"],
                    "coordinate": rec["coordinates"],
                    "file": rec["filename"],
                    "r2_key": key,
                    "stato": status,
                    "dettaglio": detail,
                }, category, message

            except Exception as exc:
                message = str(exc).replace("\n", " ").strip()
                return rec, {
                    "tipo": "PIN_KML",
                    "nome": rec["name"],
                    "coordinate": rec["coordinates"],
                    "file": rec["filename"],
                    "r2_key": key,
                    "stato": "ERRORE_ANALISI",
                    "dettaglio": message,
                }, "errori", "ERRORE: " + message

        # executor.map mantiene l'ordine del KML nel report,
        # pur eseguendo i lavori in parallelo.
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            for completed, result in enumerate(
                executor.map(inspect_record, keyed_records), 1
            ):
                rec, row, category, message = result
                rows.append(row)
                counts[category] += 1
                if category == "errori":
                    incomplete = True
                print(f"[{completed}/{len(records)}] {rec['name']}")
                print("    " + message)
                print()

    stale_objects = sorted(set(bucket_objects) - expected_keys)

    if incomplete:
        print("ATTENZIONE: analisi approfondita incompleta.")
        print("Gli oggetti non associati non saranno classificati come eliminabili.")
        for key in stale_objects:
            rows.append({
                "tipo": "OGGETTO_R2",
                "nome": Path(key).stem,
                "coordinate": "",
                "file": Path(key).name,
                "r2_key": key,
                "stato": "NON_CLASSIFICABILE_ANALISI_INCOMPLETA",
                "dettaglio": (
                    "Presente in R2 ma analisi KML non completamente riuscita"
                ),
            })
        deletions = 0
    else:
        deletions = len(stale_objects)
        for key in stale_objects:
            rows.append({
                "tipo": "OGGETTO_R2",
                "nome": Path(key).stem,
                "coordinate": "",
                "file": Path(key).name,
                "r2_key": key,
                "stato": "OBSOLETO_DA_VALUTARE",
                "dettaglio": (
                    "Oggetto R2 non corrispondente ad alcun nome file del KML"
                ),
            })

    try:
        write_report(report_path, rows)
    except Exception as exc:
        print(f"ERRORE: impossibile scrivere il report CSV: {exc}")
        return 4

    print("=" * 62)
    print("RIEPILOGO SINCRONIZZAZIONE")
    print(f"Modalità:                      {args.mode.upper()}")
    print(f"Placemark KML:                 {len(records)}")
    print(f"Oggetti attuali R2:            {len(bucket_objects)}")
    print(f"Nuovi elementi:                {counts['nuovi']}")

    if args.mode == "deep":
        print(f"Immagini da sovrascrivere:     {counts['sovrascritti']}")
        print(f"Elementi invariati:            {counts['invariati']}")
    else:
        print(f"Oggetti presenti da verificare: {counts['da_verificare']}")
        print("Nota: l'inventario rapido non può rilevare immagini modificate.")

    if incomplete:
        print(f"Errori di analisi:             {counts['errori']}")
        print("Oggetti potenzialmente obsoleti: NON DETERMINABILI")
        print("ESITO: ANALISI INCOMPLETA — nessuna modifica eseguita.")
    else:
        print(f"Oggetti R2 non presenti nel KML: {deletions}")
        print("Nota: gli oggetti non presenti nel KML sono solo segnalati, non eliminati.")
        print("ESITO: ANALISI COMPLETATA — nessuna modifica eseguita.")

    print("Report CSV:", report_path.resolve())
    return 0 if not incomplete else 1


if __name__ == "__main__":
    sys.exit(main())
