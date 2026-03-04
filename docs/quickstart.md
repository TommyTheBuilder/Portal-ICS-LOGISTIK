# Quickstart – Beleg-Template-Designer

## Start
1. Ab Repo-Root installieren:
   ```bash
   npm install
   ```
2. Entwicklungsmodus starten (Web + API):
   ```bash
   npm run dev
   ```
3. Web öffnen: `http://localhost:5173`

## Neues Template anlegen
1. Im linken Panel Elementtyp wählen (`text`, `rect`, `table`, ...).
2. Element auf der A4-Arbeitsfläche platzieren/verschieben.
3. Im rechten Property-Panel Werte in **mm** einstellen (`x/y/w/h`, Font, Align, etc.).
4. Für dynamische Inhalte `Field ID` und `Field Type` setzen (z. B. `belegnummer`, `datum`).
5. Template-Namen setzen und **Auf Server speichern** klicken.

## Bestehende Templates laden
1. **Laden** klicken.
2. Namen aus der Liste (API `/templates`) auswählen.
3. Änderungen vornehmen und erneut speichern.

## Export
- **PDF Export**: erzeugt DIN-A4 PDF (210×297 mm, ohne Skalierung).
- **PNG Export**: erzeugt eine hochauflösende Vorschau.

## Qualität & Validierung
- Collision-Check meldet Überlappungen von Bounding-Boxes im Editor.
- Belegnummer-Format wird gegen `ICSL1-YYYYMMDD-000001` geprüft.

## Dateien
- Templates liegen lokal unter `/templates/*.json`.
- Beispielvorlage: `templates/Palettenschein-ICS.json`.
