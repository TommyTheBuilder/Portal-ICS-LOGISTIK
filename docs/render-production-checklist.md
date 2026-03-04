# Production-Checkliste (Option A) – Render

Diese Checkliste beschreibt den stabilen Betrieb des Palettenportals **inkl. integriertem Template-Designer** unter `/template-designer` (kein separater Frontend-Host notwendig).

## Zielbild
- Ein Render Web Service hostet `server.js`.
- Der Template-Designer wird als statischer Build in `apps/web/dist` erzeugt.
- `server.js` liefert den Designer unter `/template-designer` direkt aus.

Relevante Implementierung:
- Designer-Route und Dist-Serving in `server.js`.
- Admin-Button zeigt auf `/template-designer`.

---

## 0) Empfohlen: Blueprint nutzen (`render.yaml`)
Im Repo liegt eine fertige `render.yaml`, die den korrekten Build-Flow für den integrierten Designer setzt.

Wenn du den Service neu aufsetzt, nutze in Render **Blueprint / IaC** statt manueller Commands.

---

## 1) Render Service anlegen
1. **New + Web Service** auswählen.
2. Repository verbinden.
3. Runtime: **Node**.
4. Region nach Nutzerstandort wählen.

---

## 2) Build- und Start-Commands
Verwende diese Kommandos im Render-Dashboard:

### Build Command
```bash
npm install && npm run build --workspace @ics/template-web
```

Warum: Dadurch entsteht `apps/web/dist`, das vom Hauptserver ausgeliefert wird.

### Start Command
```bash
npm start
```

`npm start` startet Migration + `server.js`.

---

## 3) Wichtige Environment-Variablen
Mindestens setzen:

- `NODE_ENV=production`
- `JWT_SECRET=<starkes-geheimnis>`
- `CORS_ORIGIN=https://<deine-render-domain>`

Optional:
- `MAX_BODY_SIZE=100kb` (bei Bedarf erhöhen)
- `TEMPLATE_DESIGNER_URL` **nur** wenn Designer extern gehostet wird (für Option A normalerweise **nicht** nötig)

Datenbank-bezogen (falls externes Postgres):
- `DATABASE_URL` oder die im Projekt erwarteten PG-Parameter entsprechend bestehender DB-Konfiguration.

---

## 4) Deploy-Reihenfolge / Erstinbetriebnahme
1. Variablen setzen.
2. Deploy starten.
3. Im Log prüfen:
   - Migration erfolgreich
   - Server startet ohne Missing-Module
4. Health-Check im Browser:
   - `/login.html`
   - `/admin.html`
   - `/template-designer` (muss jetzt den Designer laden, nicht die Fallback-Seite)

---

## 5) Funktionaler Smoke-Test (nach Deploy)
1. Admin-Login.
2. In Admin auf **Template-Designer** klicken.
3. Im Designer:
   - Template öffnen/neu anlegen
   - Element verschieben
   - Speichern
   - PDF-Export
4. API-Endpoints kurz prüfen:
   - `GET /templates`
   - `GET /templates/Palettenschein-ICS`

---

## 6) Häufige Fehlerbilder + Lösung

### A) „Template-Designer nicht verfügbar“
Ursache: `apps/web/dist` fehlt im Deploy-Artefakt.

Lösung:
- Prüfen, ob Build Command wirklich `npm run build --workspace @ics/template-web` ausführt.
- Neu deployen.

### B) `Cannot find module ...`
Ursache: Abhängigkeiten nicht im Root-Install enthalten.

Lösung:
- Build Command muss `npm install` auf Repo-Root ausführen.
- Prüfen, ob `package.json` Root alle Runtime-Dependencies enthält.

### C) CORS-Fehler im Browser
Ursache: `CORS_ORIGIN` passt nicht zur echten Domain.

Lösung:
- `CORS_ORIGIN` auf exakte Render-URL setzen.

---

## 7) Rollback-Strategie
- In Render auf letzten erfolgreichen Deploy zurückrollen.
- Falls nötig `TEMPLATE_DESIGNER_URL` temporär auf externen stabilen Designer setzen.

---

## 8) Security-Minimum
- `JWT_SECRET` regelmäßig rotieren.
- `CORS_ORIGIN` nie auf `*` in Produktion.
- Nur HTTPS-URL verwenden.
- Admin-Zugänge mit starken Passwörtern absichern.

---

## 9) Empfohlene Betriebsroutine
- Vor jedem Release:
  - `npm run build --workspace @ics/template-web` lokal prüfen
  - kurzer Smoke-Test gemäß Abschnitt 5
- Nach jedem Release:
  - `/template-designer` und PDF-Export einmal manuell testen



### D) Fallback-Seite erscheint trotz erfolgreichem Deploy
Ursache: Service läuft noch auf alten Commands/alten Deploy-Settings.

Lösung:
- Prüfen, ob Build Command wirklich den Web-Build ausführt.
- Sicherstellen, dass kein alter Cache/alte Branch deployed ist.
- Bei Bedarf Service neu über `render.yaml` (Blueprint) erstellen.
