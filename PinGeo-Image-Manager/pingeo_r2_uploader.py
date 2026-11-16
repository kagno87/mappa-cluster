#!/usr/bin/env python3
# PinGeo R2 Uploader - default: verifica soltanto, senza upload.
import argparse, csv, hashlib, json, mimetypes, sys, urllib.error, urllib.request
from pathlib import Path
from urllib.parse import quote, urlsplit

BASE = Path(__file__).resolve().parent

def read_config(path):
    cfg = json.loads(path.read_text(encoding="utf-8"))
    required = ["account_id", "access_key_id", "secret_access_key",
                "endpoint_url", "bucket_name", "public_url"]
    missing = [k for k in required if not str(cfg.get(k, "")).strip()]
    if missing:
        raise ValueError("Campi mancanti in r2_config.json: " + ", ".join(missing))
    for field in ("endpoint_url", "public_url"):
        u = urlsplit(cfg[field])
        if u.scheme != "https" or not u.netloc:
            raise ValueError(f"{field} deve essere un URL HTTPS valido")
    if urlsplit(cfg["public_url"]).path not in ("", "/"):
        raise ValueError("public_url deve contenere solo il dominio base")
    return cfg

def make_client(cfg):
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3", endpoint_url=cfg["endpoint_url"].rstrip("/"),
        aws_access_key_id=cfg["access_key_id"],
        aws_secret_access_key=cfg["secret_access_key"],
        region_name="auto",
        config=Config(signature_version="s3v4",
                      retries={"max_attempts": 3, "mode": "standard"})
    )

def inspect_jpeg(path):
    from PIL import Image
    with Image.open(path) as im:
        im.verify()
    with Image.open(path) as im:
        if im.format != "JPEG":
            raise ValueError(f"{path.name}: il contenuto non è JPEG")
        width, height = im.size
    raw = path.read_bytes()
    return {"path": path, "name": path.name, "size": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "width": width, "height": height}

def make_url(base, key):
    return base.rstrip("/") + "/" + "/".join(
        quote(part, safe="-_.~") for part in key.split("/")
    )

def public_head(url):
    req = urllib.request.Request(url, method="HEAD",
                                 headers={"User-Agent": "PinGeo-R2-Uploader/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return str(res.status)
    except urllib.error.HTTPError as exc:
        return str(exc.code)
    except Exception as exc:
        return "NON_VERIFICATO: " + str(exc)

def main():
    ap = argparse.ArgumentParser(description="PinGeo R2 Uploader")
    ap.add_argument("--config", default=str(BASE / "r2_config.json"))
    ap.add_argument("--input-dir", default=str(BASE / "input" / "bianco-test_jpeg"))
    ap.add_argument("--prefix", default="", help="Prefisso opzionale, es. bianco/")
    ap.add_argument("--upload", action="store_true",
                    help="Esegue l'upload; senza questa opzione fa solo verifica")
    ap.add_argument("--overwrite", action="store_true",
                    help="Consente di sovrascrivere oggetti diversi (richiede --upload)")
    ap.add_argument("--manifest", default=None)
    args = ap.parse_args()

    print("\nPinGeo R2 UPLOADER")
    print("Modalità:", "UPLOAD" if args.upload else "SOLO VERIFICA")
    if args.overwrite and not args.upload:
        print("ERRORE: --overwrite richiede anche --upload.")
        return 2

    try:
        cfg = read_config(Path(args.config).expanduser())
        folder = Path(args.input_dir).expanduser()
        if not folder.is_dir():
            raise FileNotFoundError(f"Cartella JPEG non trovata: {folder}")
        paths = sorted(p for p in folder.iterdir()
                       if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg"))
        if not paths:
            raise ValueError(f"Nessun JPG/JPEG trovato in {folder}")
        records = [inspect_jpeg(p) for p in paths]
        client = make_client(cfg)
    except ImportError as exc:
        print(f"ERRORE: dipendenza mancante: {exc}")
        return 2
    except Exception as exc:
        print(f"ERRORE: {exc}")
        return 2

    bucket = cfg["bucket_name"]
    prefix = args.prefix.strip("/")
    print(f"Bucket: {bucket}")
    print(f"JPEG validi: {len(records)}")
    try:
        client.head_bucket(Bucket=bucket)
        print("Connessione e accesso al bucket: OK\n")
    except Exception as exc:
        print("ERRORE: accesso al bucket non riuscito.")
        print("Dettaglio:", exc)
        return 3

    rows, errors = [], 0
    for rec in records:
        key = f"{prefix}/{rec['name']}" if prefix else rec["name"]
        url = make_url(cfg["public_url"], key)
        row = {"file": rec["name"], "r2_key": key, "public_url": url,
               "local_bytes": rec["size"], "r2_bytes": "",
               "sha256": rec["sha256"], "width_px": rec["width"],
               "height_px": rec["height"], "status": "", "public_http": ""}
        print(f"[{rec['name']}]")
        print(f"  Locale: {rec['size']:,} byte, {rec['width']}x{rec['height']} px")
        try:
            existing = None
            try:
                existing = client.head_object(Bucket=bucket, Key=key)
            except Exception as exc:
                response = getattr(exc, "response", {})
                http = str(response.get("ResponseMetadata", {}).get("HTTPStatusCode", ""))
                code = str(response.get("Error", {}).get("Code", ""))
                if http != "404" and code not in ("404", "NoSuchKey", "NotFound"):
                    raise

            if existing:
                meta = existing.get("Metadata", {})
                same = (meta.get("sha256") == rec["sha256"]
                        and existing.get("ContentLength") == rec["size"])
                row["r2_bytes"] = existing.get("ContentLength", "")
                if same:
                    row["status"] = "GIA_PRESENTE_IDENTICO"
                    print("  R2: già presente e identico; upload non necessario.")
                elif not args.overwrite:
                    row["status"] = "CONFLITTO_NON_SOVRASCRITTO"
                    errors += 1
                    print("  ERRORE: esiste già un oggetto diverso; non sovrascritto.")
                elif args.upload:
                    existing = None
                else:
                    row["status"] = "SOVRASCRITTURA_RICHIESTA"
                    errors += 1
                    print("  ERRORE: per sostituire l'oggetto serve --upload --overwrite.")

            if not existing and not row["status"]:
                if not args.upload:
                    row["status"] = "PRONTO_UPLOAD"
                    print("  R2: oggetto assente; pronto per l'upload.")
                else:
                    client.upload_file(
                        str(rec["path"]), bucket, key,
                        ExtraArgs={
                            "ContentType": mimetypes.guess_type(rec["name"])[0] or "image/jpeg",
                            "CacheControl": "public, max-age=31536000, immutable",
                            "Metadata": {"sha256": rec["sha256"]}
                        }
                    )
                    check = client.head_object(Bucket=bucket, Key=key)
                    if check.get("ContentLength") != rec["size"]:
                        raise RuntimeError("dimensione su R2 diversa dal file locale")
                    if check.get("Metadata", {}).get("sha256") != rec["sha256"]:
                        raise RuntimeError("SHA-256 metadata non corrispondente")
                    row["r2_bytes"] = check["ContentLength"]
                    row["status"] = "CARICATO_VERIFICATO"
                    print("  Upload e verifica R2: OK.")

            if args.upload and row["status"] in ("CARICATO_VERIFICATO", "GIA_PRESENTE_IDENTICO"):
                row["public_http"] = public_head(url)
                print("  Verifica URL pubblico:", row["public_http"])
            print("  URL:", url)
        except Exception as exc:
            row["status"] = "ERRORE"
            errors += 1
            print("  ERRORE:", exc)
        rows.append(row)
        print()

    manifest = Path(args.manifest).expanduser() if args.manifest else folder / "r2_upload_manifest.csv"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    fields = ["file", "r2_key", "public_url", "local_bytes", "r2_bytes",
              "sha256", "width_px", "height_px", "status", "public_http"]
    with manifest.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields, delimiter=";")
        writer.writeheader()
        writer.writerows(rows)

    print("=" * 58)
    print(f"Problemi: {errors}")
    print("Manifest:", manifest.resolve())
    if args.upload:
        print("ESITO: upload terminato; controllare manifest e URL pubblici.")
    else:
        print("ESITO: sola verifica. Nessun file caricato o modificato.")
        print("Per caricare, ripetere il comando aggiungendo --upload.")
    return 0 if errors == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
