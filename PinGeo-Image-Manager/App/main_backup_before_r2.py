import customtkinter as ctk

# --------------------------------------------------
# CONFIGURAZIONE
# --------------------------------------------------

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

APP_TITLE = "PinGeo Image Manager"

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
        self.layer_selector.grid(row=1, column=0, padx=15, pady=(0, 15), sticky="w")

        buttons = ctk.CTkFrame(controls, fg_color="transparent")
        buttons.grid(row=2, column=0, padx=10, pady=(0, 15), sticky="ew")

        buttons.grid_columnconfigure((0, 1, 2, 3), weight=1)

        self.connection_button = ctk.CTkButton(
            buttons,
            text="1. Verifica connessione",
            command=self.not_implemented
        )
        self.connection_button.grid(row=0, column=0, padx=5, pady=5, sticky="ew")

        self.kml_button = ctk.CTkButton(
            buttons,
            text="2. Verifica KML",
            command=self.not_implemented
        )
        self.kml_button.grid(row=0, column=1, padx=5, pady=5, sticky="ew")

        self.analysis_button = ctk.CTkButton(
            buttons,
            text="3. Analizza sincronizzazione",
            command=self.not_implemented
        )
        self.analysis_button.grid(row=0, column=2, padx=5, pady=5, sticky="ew")

        self.sync_button = ctk.CTkButton(
            buttons,
            text="4. Sincronizza",
            command=self.not_implemented,
            fg_color="#16834A",
            hover_color="#11683A"
        )
        self.sync_button.grid(row=0, column=3, padx=5, pady=5, sticky="ew")

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
        self.output.grid(row=1, column=0, padx=15, pady=(0, 15), sticky="nsew")

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

        self.status_label = ctk.CTkLabel(
            status,
            text="Pronto",
            font=ctk.CTkFont(size=12),
            text_color="gray"
        )
        self.status_label.grid(row=0, column=0, padx=20, pady=10, sticky="w")

    # --------------------------------------------------
    # SEGNAPOSTO TEMPORANEO
    # --------------------------------------------------

    def not_implemented(self):
        self.status_label.configure(
            text="Funzione non ancora collegata alla pipeline."
        )


if __name__ == "__main__":
    app = PinGeoApp()
    app.mainloop()
