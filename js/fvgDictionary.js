/*

* FVG4ALL
* ============================================================
* Dizionario territoriale per OCR
* Friuli Venezia Giulia
*
* Questo file contiene parole utili per interpretare
* le locandine degli eventi.
*
* NON elimina automaticamente le parole sconosciute.
* Viene utilizzato per correggere e assegnare punteggi.
  */

const FVG_DICTIONARY = {

/*

* ==========================================================
* REGIONI / TERRITORIO
* ==========================================================
  */

regione: [
"Friuli",
"Venezia",
"Giulia",
"Friuli Venezia Giulia"
],

/*

* ==========================================================
* CAPOLUOGHI
* ==========================================================
  */

capoluoghi: [
"Trieste",
"Udine",
"Gorizia",
"Pordenone"
],

/*

* ==========================================================
* PROVINCE / EX PROVINCE
* ==========================================================
  */

province: [
"Trieste",
"Udine",
"Gorizia",
"Pordenone"
],

/*

* ==========================================================
* PAROLE TIPICHE DEGLI EVENTI
* ==========================================================
  */

eventi: [
"Sagra",
"Sagras",
"Festa",
"Feste",
"Festeggiamenti",
"Fiera",
"Fiere",
"Festival",
"Mostra",
"Mostre",
"Rassegna",
"Rassegne",
"Palio",
"Mercato",
"Manifestazione",
"Manifestazioni",
"Evento",
"Eventi",
"Kermesse",
"Raduno",
"Raduni",
"Concerto",
"Concerti",
"Spettacolo",
"Spettacoli",
"Folk",
"Tradizione",
"Tradizionale",
"Enogastronomico",
"Enogastronomia",
"Gastronomia"
],

/*

* ==========================================================
* ORGANIZZATORI
* ==========================================================
  */

organizzatori: [
"Comune",
"Comuni",
"Pro Loco",
"Proloco",
"Associazione",
"Associazioni",
"Comitato",
"Comitato organizzatore",
"Volontari",
"Parrocchia",
"Regione",
"Provincia"
],

/*

* ==========================================================
* PAROLE FREQUENTI NELLE LOCANDINE
* ==========================================================
  */

paroleEvento: [
"programma",
"programma",
"ingresso",
"gratuito",
"gratuita",
"info",
"informazioni",
"prenotazioni",
"prenotazione",
"apertura",
"inizio",
"ore",
"serata",
"giornata",
"edizione",
"edizioni",
"annuale",
"tradizione",
"tradizionale",
"musica",
"ballo",
"danza",
"gastronomia",
"cucina",
"prodotti",
"tipici",
"stand",
"degustazione",
"degustazioni"
],

/*

* ==========================================================
* LOCALITÀ / TERRITORI FVG
*
* Questa lista può essere ampliata nel tempo.
* ==========================================================
  */

localita: [
"Monfalcone",
"Ronchi dei Legionari",
"Staranzano",
"Sagrado",
"Gradisca d'Isonzo",
"Cormons",
"Capriva del Friuli",
"San Lorenzo Isontino",
"Fogliano Redipuglia",
"Turriaco",
"Doberdò del Lago",
"Doberdo del Lago",
"Grado",
"Aquileia",
"Palmanova",
"Cividale del Friuli",
"San Daniele del Friuli",
"Spilimbergo",
"Maniago",
"Sacile",
"Lignano Sabbiadoro",
"Tarvisio",
"Tolmezzo",
"Gemona del Friuli",
"Codroipo",
"Rivignano",
"San Giorgio di Nogaro",
"Cervignano del Friuli",
"Latisana",
"Duino",
"Aurisina",
"Muggia",
"Miramare",
"Carso",
"Collio",
"Carnia",
"Bisiacaria"
],

/*

* ==========================================================
* MESI
* ==========================================================
  */

mesi: [
"gennaio",
"febbraio",
"marzo",
"aprile",
"maggio",
"giugno",
"luglio",
"agosto",
"settembre",
"ottobre",
"novembre",
"dicembre"
]

};

/*

* ============================================================
* CORREZIONI OCR
* ============================================================
*
* Errori tipici che possono comparire nelle locandine.
*
* Le correzioni vengono applicate SOLO quando la parola
* corrisponde esattamente alla chiave.
  */

const FVG_OCR_CORRECTIONS = {

"SAGRAA": "SAGRA",

"FESTAA": "FESTA",

"CORM0NS": "CORMONS",

"CORMONS": "Cormons",

"G0RIZIA": "GORIZIA",

"GORIZlA": "GORIZIA",

"P0RDENONE": "PORDENONE",

"PORDEN0NE": "PORDENONE",

"UDlNE": "UDINE",

"TRlESTE": "TRIESTE",

"MONFALC0NE": "MONFALCONE",

"MONFALCONEE": "MONFALCONE",

"FRIULl": "FRIULI",

"FESTEGGIAMENTl": "FESTEGGIAMENTI"

};

/*

* ============================================================
* FUNZIONI PUBBLICHE
* ============================================================
  */

/*

* Normalizza una parola per il confronto.
  */
  function fvgNormalizeWord(word) {

return String(word)
.toLowerCase()
.normalize("NFD")
.replace(/[\u0300-\u036f]/g, "")
.trim();

}

/*

* Cerca una parola nel dizionario.
  */
  function fvgIsKnownWord(word) {

const normalized =
fvgNormalizeWord(word);

for (const categoria of Object.values(FVG_DICTIONARY)) {

```
if (
  categoria.some(
    voce =>
      fvgNormalizeWord(voce) === normalized
  )
) {

  return true;

}
```

}

return false;

}

/*

* Restituisce la categoria della parola.
  */
  function fvgGetCategory(word) {

const normalized =
fvgNormalizeWord(word);

for (
const [categoria, valori]
of Object.entries(FVG_DICTIONARY)
) {

```
if (
  valori.some(
    voce =>
      fvgNormalizeWord(voce) === normalized
  )
) {

  return categoria;

}
```

}

return "";

}

/*

* Corregge una parola riconosciuta male dall'OCR.
  */
  function fvgCorrectOCR(word) {

const key =
String(word)
.toUpperCase()
.trim();

return (
FVG_OCR_CORRECTIONS[key]
|| word
);

}

/*

* Assegna un punteggio territoriale.
*
* Più alto = parola più interessante
* per l'identificazione dell'evento.
  */
  function fvgWordScore(word) {

const category =
fvgGetCategory(word);

switch (category) {

```
case "eventi":
  return 10;

case "capoluoghi":
  return 10;

case "province":
  return 10;

case "localita":
  return 9;

case "organizzatori":
  return 6;

case "mesi":
  return 8;

case "paroleEvento":
  return 4;

case "regione":
  return 5;

default:
  return 0;
```

}

}

/*

* Analizza una riga OCR.
  */
  function fvgAnalyzeLine(line) {

const parole =
String(line)
.split(/\s+/)
.filter(Boolean);

let score = 0;
let paroleRiconosciute = 0;

for (const parola of parole) {

```
const corrected =
  fvgCorrectOCR(parola);

const wordScore =
  fvgWordScore(corrected);

score += wordScore;

if (wordScore > 0) {
  paroleRiconosciute++;
}
```

}

return {

```
line: line,

score: score,

paroleRiconosciute:
  paroleRiconosciute
```

};

}

/*

* Corregge tutto il testo OCR.
  */
  function fvgCorrectOCRText(text) {

return String(text)

```
.split(/\b/)

.map(parte => {

  if (
    /^[a-zA-ZÀ-ÖØ-öø-ÿ]+$/.test(parte)
  ) {

    return fvgCorrectOCR(parte);

  }

  return parte;

})

.join("");
```

}
