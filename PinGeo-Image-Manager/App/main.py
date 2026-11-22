import sys
import threading
import subprocess
import os
import re
import tempfile
import shutil
from pathlib import Path
from tkinter import filedialog

import customtkinter as ctk

# --------------------------------------------------
# CONFIGURAZIONE
# --------------------------------------------------

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

APP_TITLE = "PinGeo Image Manager"

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent
CONFIG_PATH = PROJECT_DIR / "r2_config.json"
PRECHECK_SCRIPT = PROJECT_DIR / "pingeo_precheck.py"

# Importa le funzioni R2 già presenti nella pipeline.
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

import pingeo_r2_sync_diagnostic as r2_core


LAYERS = [
    "bianco", "nero", "giallo", "blu", "marrone",
    "rosso", "verde", "viola", "grigio", "turchese", "rosa"
]


class PinGeoApp(ctk.CTk):

    def __init__(self):
        super().__init__()

        self.title(APP_TITLE)
        self.geometry("1050x720")
        self.minsize(900, 650)

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        self.create_header()
        self.create_controls()
        self.create_results()
        self.create_statusbar()

    # --------------------------------------------------
    # HEADER
    # --------------------------------------------------

    def create_header(self):

        header = ctk.CTkFrame(self, corner_radius=0)
        header.grid(row=0, column=0, sticky="ew")
        header.grid_columnconfigure(0, weight=1)

        title = ctk.CTkLabel(
            header,
            text="PinGeo Image Manager",
            font=ctk.CTkFont(size=27, weight="bold")
        )
        title.grid(row=0, column=0, padx=25, pady=(20, 4), sticky="w")

        subtitle = ctk.CTkLabel(
            header,
            text="Gestione immagini e sincronizzazione Cloudflare R2",
            font=ctk.CTkFont(size=13),
            text_color="gray"
        )
        subtitle.grid(row=1, column=0, padx=27, pady=(0, 20), sticky="w")

    # --------------------------------------------------
    # CONTROLLI
    # --------------------------------------------------

    def create_controls(self):

        controls = ctk.CTkFrame(self)
        controls.grid(row=1, column=0, padx=20, pady=15, sticky="ew")
        controls.grid_columnconfigure(0, weight=1)

        layer_label = ctk.CTkLabel(
            controls,
            text="LAYER DA GESTIRE",
            font=ctk.CTkFont(size=12, weight="bold")
        )
        layer_label.grid(row=0, column=0, padx=15, pady=(15, 5), sticky="w")

        self.layer_selector = ctk.CTkComboBox(
            controls,
            values=LAYERS,
            width=220,
            state="readonly"
        )
        self.layer_selector.set("bianco")
        self.layer_selector.grid(
            row=1, column=0, padx=15, pady=(0, 15), sticky="w"
        )

        buttons = ctk.CTkFrame(controls, fg_color="transparent")
        buttons.grid(row=2, column=0, padx=10, pady=(0, 15), sticky="ew")

        buttons.grid_columnconfigure((0, 1, 2, 3), weight=1)

        self.connection_button = ctk.CTkButton(
            buttons,
            text="1. Verifica connessione",
            command=self.check_connection
        )
        self.connection_button.grid(
            row=0, column=0, padx=5, pady=5, sticky="ew"
        )

        self.kml_button = ctk.CTkButton(
            buttons,
            text="2. Verifica KML",
            command=self.verify_kml
        )
        self.kml_button.grid(
            row=0, column=1, padx=5, pady=5, sticky="ew"
        )

        self.analysis_button = ctk.CTkButton(
            buttons,
            text="3. Analizza e sincronizza",
            command=self.analyze_kml
        )
        self.analysis_button.grid(
            row=0, column=2, padx=5, pady=5, sticky="ew"
        )

        self.sync_button = ctk.CTkButton(
            buttons,
            text="4. Crea GeoJSON",
            command=self.not_implemented,
            fg_color="#16834A",
            hover_color="#11683A"
        )
        self.sync_button.grid(
            row=0, column=3, padx=5, pady=5, sticky="ew"
        )

    # --------------------------------------------------
    # AREA RISULTATI
    # --------------------------------------------------

    def create_results(self):

        results = ctk.CTkFrame(self)
        results.grid(row=2, column=0, padx=20, pady=(0, 15), sticky="nsew")

        results.grid_columnconfigure(0, weight=1)
        results.grid_rowconfigure(1, weight=1)

        heading = ctk.CTkLabel(
            results,
            text="RISULTATI E DETTAGLI OPERAZIONI",
            font=ctk.CTkFont(size=13, weight="bold")
        )
        heading.grid(row=0, column=0, padx=15, pady=15, sticky="w")

        self.output = ctk.CTkTextbox(
            results,
            wrap="word",
            font=ctk.CTkFont(size=13)
        )
        self.output.grid(
            row=1, column=0, padx=15, pady=(0, 15), sticky="nsew"
        )

        self.output.insert(
            "end",
            "Benvenuto in PinGeo Image Manager.\n\n"
            "Seleziona un layer e scegli l'operazione da eseguire.\n\n"
            "In quest'area verranno visualizzati:\n"
            "• Esito della connessione a Cloudflare R2\n"
            "• Anomalie riscontrate nel KML\n"
            "• Riepilogo delle immagini da aggiungere, sostituire o eliminare\n"
            "• Avanzamento e risultato della sincronizzazione\n"
        )
        self.output.configure(state="disabled")

    # --------------------------------------------------
    # BARRA DI STATO
    # --------------------------------------------------

    def create_statusbar(self):

        status = ctk.CTkFrame(self, corner_radius=0)
        status.grid(row=3, column=0, sticky="ew")
        status.grid_columnconfigure(0, weight=1)
        status.grid_columnconfigure(1, weight=0)

        self.status_label = ctk.CTkLabel(
            status,
            text="Pronto",
            font=ctk.CTkFont(size=12),
            text_color="gray"
        )
        self.status_label.grid(
            row=0, column=0, padx=(20, 12), pady=10, sticky="w"
        )

        self.precheck_progress = ctk.CTkProgressBar(
            status,
            width=230,
            mode="determinate"
        )
        self.precheck_progress.grid(
            row=0, column=1, padx=(8, 20), pady=10, sticky="e"
        )
        self.precheck_progress.set(0)

    # --------------------------------------------------
    # GESTIONE OUTPUT
    # --------------------------------------------------

    def write_output(self, message):

        self.output.configure(state="normal")
        self.output.insert("end", message + "\n")
        self.output.see("end")
        self.output.configure(state="disabled")

    def run_command_with_progress(self, command, env, status_prefix):
        """Esegue un comando e aggiorna la barra leggendo le righe PROGRESS."""
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            cwd=str(PROJECT_DIR),
            env=env,
        )

        output_lines = []
        progress_pattern = re.compile(
            r"PROGRESS:\s*(\d+)\s*/\s*(\d+)\s*\((\d+)%\)"
        )
        placemark_pattern = re.compile(
            r"^\[[✓?!X]\]\s*(\d+)\s*/\s*(\d+)\s*\((\d+)%\)"
        )

        for line in process.stdout:
            output_lines.append(line)
            match = progress_pattern.search(line) or placemark_pattern.search(line)
            if match:
                completed = int(match.group(1))
                total = max(1, int(match.group(2)))
                percent = int(match.group(3))
                status_text = (
                    f"{status_prefix} — {completed}/{total} ({percent}%)"
                )
                self.after(
                    0,
                    self.update_precheck_progress,
                    percent / 100,
                    status_text,
                )

        process.wait()
        return process.returncode, "".join(output_lines), ""

    def update_precheck_progress(self, fraction, status_text=None):
        self.precheck_progress.set(max(0.0, min(1.0, fraction)))
        if status_text:
            self.status_label.configure(text=status_text)


    # --------------------------------------------------
    # VERIFICA CONNESSIONE R2
    # --------------------------------------------------

    def check_connection(self):

        layer = self.layer_selector.get().strip().lower()

        if layer not in LAYERS:
            self.write_output("ERRORE: layer selezionato non valido.")
            return

        self.connection_button.configure(state="disabled")
        self.status_label.configure(text=f"Verifica connessione R2 — {layer}...")

        self.write_output("")
        self.write_output("========================================")
        self.write_output("VERIFICA CONNESSIONE CLOUDFLARE R2")
        self.write_output(f"Layer selezionato: {layer}")
        self.write_output("Operazione: sola lettura")
        self.write_output("")

        worker = threading.Thread(
            target=self.connection_worker,
            args=(layer,),
            daemon=True
        )
        worker.start()

    def connection_worker(self, layer):

        try:
            if not CONFIG_PATH.is_file():
                raise FileNotFoundError(
                    "File r2_config.json non trovato nella cartella principale "
                    "PinGeo-Image-Manager."
                )

            # Legge e valida la configurazione esistente.
            cfg = r2_core.read_config(CONFIG_PATH)

            # Crea il client utilizzato dalla pipeline.
            client = r2_core.make_client(cfg)

            bucket = cfg["bucket_name"]
            prefix = layer + "/"

            # Controlla accesso al bucket e permessi di lettura.
            client.head_bucket(Bucket=bucket)

            response = client.list_objects_v2(
                Bucket=bucket,
                Prefix=prefix,
                MaxKeys=1
            )

            result = {
                "success": True,
                "bucket": bucket,
                "layer": layer,
                "prefix": prefix,
                "has_objects": bool(response.get("Contents")),
            }

        except Exception as exc:
            result = {
                "success": False,
                "error": str(exc),
            }

        self.after(0, self.connection_finished, result)

    def connection_finished(self, result):

        self.connection_button.configure(state="normal")

        if result["success"]:

            self.write_output("ESITO: CONNESSIONE RIUSCITA")
            self.write_output(f"Bucket: {result['bucket']}")
            self.write_output(f"Prefisso controllato: {result['prefix']}")

            if result["has_objects"]:
                self.write_output(
                    "Accesso in lettura verificato: "
                    "sono presenti oggetti nel layer."
                )
            else:
                self.write_output(
                    "Accesso in lettura verificato: "
                    "nessun oggetto trovato nel layer."
                )

            self.status_label.configure(
                text=f"Connessione R2 riuscita — {result['layer']}"
            )

        else:

            self.write_output("ESITO: CONNESSIONE NON RIUSCITA")
            self.write_output(f"Dettaglio: {result['error']}")
            self.write_output(
                "Nessuna modifica è stata eseguita su R2."
            )

            self.status_label.configure(
                text="Errore durante la verifica della connessione R2"
            )

        self.write_output("========================================")
        self.write_output("")

    # --------------------------------------------------
    # VERIFICA KML
    # --------------------------------------------------

    def verify_kml(self):

        kml_path = filedialog.askopenfilename(
            title="Seleziona il file KML da verificare",
            initialdir=str(PROJECT_DIR / "input"),
            filetypes=[
                ("File KML", "*.kml"),
                ("Tutti i file", "*.*"),
            ],
        )

        if not kml_path:
            return

        if not PRECHECK_SCRIPT.is_file():
            self.write_output(
                f"ERRORE: script precheck non trovato:\n"
                f"{PRECHECK_SCRIPT}"
            )
            self.status_label.configure(
                text="Script precheck non trovato"
            )
            return

        self.status_label.configure(
            text="KML selezionato, pronto per la verifica"
        )

        self.write_output("")
        self.write_output("========================================")
        self.write_output("VERIFICA KML")
        self.write_output(f"File selezionato: {kml_path}")
        self.write_output("========================================")
        self.status_label.configure(
            text="Verifica KML in corso..."
        )

        threading.Thread(
            target=self.run_precheck,
            args=(kml_path,),
            daemon=True,
        ).start()

    # --------------------------------------------------
    # ESECUZIONE PRECHECK KML
    # --------------------------------------------------

    def run_precheck(self, kml_path):

        command = [
            sys.executable,
            str(PRECHECK_SCRIPT),
            str(kml_path),
        ]
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"

        try:
            returncode, stdout, stderr = self.run_command_with_progress(
                command,
                env,
                "Verifica KML",
            )

            found_match = re.search(
                r"Placemark trovati:\s*(\d+)",
                stdout,
            )

            found = int(found_match.group(1)) if found_match else 0

            correct = len(
                re.findall(
                    r"^\[✓\].*— OK\s*$",
                    stdout,
                    re.MULTILINE,
                )
            )

            errors = []
            current_name = None

            for line in stdout.splitlines():

                feature_match = re.match(
                    r"^\s*\[X\]\s*(?:\d+(?:/\d+)?(?:\s*\(\d+%\))?\.?\s+)?(.*?)\s*—\s*ERRORE",
                    line,
                )

                if feature_match:
                    current_name = feature_match.group(1).strip()
                    continue

                error_match = re.match(
                    r"^\s*ERRORE:\s*(.+)",
                    line,
                )

                if error_match:
                    detail = error_match.group(1).strip()

                    if current_name:
                        errors.append(
                            f"{current_name} - {detail}"
                        )
                    else:
                        errors.append(detail)

            self.write_output("")
            self.write_output(f"FILE TROVATI: {found}")
            self.write_output(f"FILE CORRETTI: {correct}")

            if errors:
                self.write_output("FILE CON ERRORI:")

                for error in errors:
                    self.write_output(error)
            else:
                self.write_output("FILE CON ERRORI: nessuno")

            self.write_output("")

            if returncode == 2:
                self.write_output("ERRORE TECNICO")

                if stderr.strip():
                    self.write_output(stderr.strip())

            if returncode == 0:
                self.status_label.configure(
                    text="Verifica KML completata"
                )
            elif returncode == 1:
                self.status_label.configure(
                    text="Verifica completata: controllare gli errori"
                )
            else:
                self.status_label.configure(
                    text="Errore tecnico durante la verifica"
                )

            self.update_precheck_progress(1.0)

        except Exception as error:
            self.write_output(f"ERRORE: {error}")
            self.status_label.configure(
                text="Errore durante l'avvio del precheck"
            )


    # --------------------------------------------------
    # ANALISI SINCRONIZZAZIONE
    # --------------------------------------------------

    def analyze_kml(self):

        kml_path = filedialog.askopenfilename(
            title="Seleziona il file KML da analizzare",
            initialdir=str(PROJECT_DIR / "input"),
            filetypes=[
                ("File KML", "*.kml"),
                ("Tutti i file", "*.*"),
            ],
        )

        if not kml_path:
            return

        if not PRECHECK_SCRIPT.is_file():
            self.write_output(
                f"ERRORE: script precheck non trovato:\n"
                f"{PRECHECK_SCRIPT}"
            )
            self.status_label.configure(
                text="Script precheck non trovato"
            )
            return

        self.status_label.configure(
            text="KML selezionato per l'analisi"
        )

        self.write_output("")
        self.write_output("========================================")
        self.write_output("ANALISI SINCRONIZZAZIONE")
        self.write_output(f"File selezionato: {kml_path}")
        self.write_output("========================================")

        self.status_label.configure(
            text="Precheck KML in corso..."
        )

        threading.Thread(
            target=self.run_analysis_precheck,
            args=(kml_path,),
            daemon=True,
        ).start()


    # --------------------------------------------------
    # PRECHECK PRIMA DELL'ANALISI R2
    # --------------------------------------------------

    def run_analysis_precheck(self, kml_path):

        command = [
            sys.executable,
            str(PRECHECK_SCRIPT),
            str(kml_path),
        ]

        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"

        try:
            returncode, precheck_stdout, precheck_stderr = self.run_command_with_progress(
                command,
                env,
                "Precheck KML",
            )

            if returncode != 0:

                self.write_output("")
                self.write_output("PRECHECK NON SUPERATO.")
                self.write_output(
                    "Analisi R2 annullata: nessuna modifica al bucket."
                )

                if precheck_stdout.strip():
                    self.write_output(precheck_stdout.strip())

                if precheck_stderr.strip():
                    self.write_output(precheck_stderr.strip())

                self.status_label.configure(
                    text="Analisi bloccata: KML non valido"
                )
                return

            self.write_output("")
            self.write_output("PRECHECK KML: SUPERATO")
            self.write_output("Avvio analisi approfondita R2...")
            self.update_precheck_progress(0.0)

            self.status_label.configure(
                text="Precheck superato, analisi R2 in corso..."
            )


            r2_script = PROJECT_DIR / "pingeo_r2_sync_diagnostic.py"

            if not r2_script.is_file():
                self.write_output(
                    f"ERRORE: script R2 non trovato:\n{r2_script}"
                )
                self.status_label.configure(
                    text="Script R2 non trovato"
                )
                return

            cache_temp = tempfile.TemporaryDirectory(prefix="pingeo-image-cache-")
            cache_dir = cache_temp.name    

            command = [
                sys.executable,
                str(r2_script),
                str(kml_path),
                "--mode",
                "sync",
                "--gui-confirm",
                "--cache-dir",
                cache_dir,
            ]

            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    cwd=str(PROJECT_DIR),
                    env=env,
                )
            finally:
                cache_temp.cleanup()


            stdout = result.stdout or ""

            def extract_count(pattern):
                match = re.search(pattern, stdout)
                return match.group(1) if match else "N/D"

            elements_kml = extract_count(
                r"Placemark nel KML:\s*(\d+)"
            )
            elements_r2 = extract_count(
                r"Oggetti attuali R2 nella categoria:\s*(\d+)"
            )
            new_elements = extract_count(
                r"Nuovi elementi:\s*(\d+)"
            )
            updates = extract_count(
                r"Immagini da sovrascrivere:\s*(\d+)"
            )
            unchanged = extract_count(
                r"Elementi invariati:\s*(\d+)"
            )
            stale = extract_count(
                r"Oggetti obsoleti rilevati:\s*(\d+)"
            )

            report_match = re.search(
                r"Report CSV:\s*(.+)",
                stdout,
            )

            self.write_output("")
            self.write_output("RIEPILOGO")
            self.write_output(
                f"ELEMENTI DA KML: {elements_kml}"
            )
            self.write_output(
                f"ELEMENTI IN R2: {elements_r2}"
            )
            self.write_output(
                f"NUOVI ELEMENTI: {new_elements}"
            )
            self.write_output(
                f"IMMAGINI DA AGGIORNARE: {updates}"
            )
            self.write_output(
                f"ELEMENTI INVARIATI: {unchanged}"
            )
            self.write_output(
                f"ELEMENTI OBSOLETI IN R2: {stale}"
            )

            if report_match:
                report_name = Path(
                    report_match.group(1).strip()
                ).name

                self.write_output("")
                self.write_output(
                    f"REPORT CSV: {report_name}"
                )

            self.write_output("")

            if result.returncode == 0:
                self.write_output(
                    "ESITO: ANALISI COMPLETATA"
                )
                self.status_label.configure(
                    text="Analisi R2 completata"
                )

            else:
                self.write_output(
                    "ESITO: ANALISI NON COMPLETATA"
                )

                error_match = re.search(
                    r"Errori analisi:\s*(\d+)",
                    stdout,
                )

                if error_match:
                    self.write_output(
                        f"Immagini non verificate: "
                        f"{error_match.group(1)}"
                    )

                if result.stderr.strip():
                    self.write_output(
                        result.stderr.strip()
                    )

                self.status_label.configure(
                    text="Analisi R2 terminata con errori"
                )

            

        except Exception as error:
            self.write_output(
                f"ERRORE durante il precheck: {error}"
            )
            self.status_label.configure(
                text="Errore durante il precheck"
            )


    # --------------------------------------------------
    # SEGNAPOSTO TEMPORANEI
    # --------------------------------------------------

    def not_implemented(self):

        self.status_label.configure(
            text="Funzione non ancora collegata alla pipeline."
        )


if __name__ == "__main__":
    app = PinGeoApp()
    app.mainloop()
