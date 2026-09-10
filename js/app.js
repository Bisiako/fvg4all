/*
 * fvg4all
 * ------------------------------------------------------------
 * Non è necessario rinominare le immagini.
 * Non è necessario creare un file JSON.
 * Non è necessario scrivere manualmente titolo/data/descrizione.
 *
 * Il programma:
 * 1. interroga GitHub API;
 * 2. cerca ricorsivamente sotto IMAGE_ROOT;
 * 3. trova PNG/JPG/JPEG/WebP/GIF;
 * 4. mostra le immagini;
 * 5. usa Tesseract.js per estrarre il testo;
 * 6. prova automaticamente a riconoscere titolo e data dell'evento.
 *
 * IMPORTANTE:
 * Impostare OWNER e REPO con il proprio repository GitHub.
 */

const CONFIG = {
  OWNER: "Bisiako",
  REPO: "fvg4all",
  BRANCH: "main",

  // Percorso nel repository.
  // Se le immagini sono realmente in main/images/, lascia così.
  IMAGE_ROOT: "images",

  // Lingua OCR.
  OCR_LANGUAGE: "ita",

  API_URL: "https://api.github.com"
};

const state = {
  images: [],
  currentIndex: 0,
  ocrResults: new Map()
};

const gallery = document.getElementById("gallery");
const carousel = document.getElementById("carousel");
const carouselContent = document.getElementById("carouselContent");
const statusBox = document.getElementById("status");
const imageCount = document.getElementById("imageCount");

const gridButton = document.getElementById("gridButton");
const carouselButton = document.getElementById("carouselButton");
const prevButton = document.getElementById("prevButton");
const nextButton = document.getElementById("nextButton");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  if (
    CONFIG.OWNER === "TUO_USERNAME_GITHUB" ||
    CONFIG.REPO === "TUO_REPOSITORY"
  ) {
    showError(
      "Configura OWNER e REPO all'inizio di app.js prima di pubblicare il sito."
    );
    return;
  }

  try {
    setStatus("Ricerca delle locandine su GitHub…");

    const files = await findImages();

    state.images = files;
    imageCount.textContent = files.length;

    if (!files.length) {
      setStatus("Nessuna immagine trovata in " + CONFIG.IMAGE_ROOT);
      return;
    }

    renderGallery(files);

    setStatus(
      `${files.length} locandin${files.length === 1 ? "a" : "e"} trovata/e. ` +
      "Avvio dell'analisi OCR…"
    );

    processOCRSequentially(files);

  } catch (error) {
    console.error(error);

    showError(
      "Errore durante la lettura di GitHub: " + error.message
    );
  }
}


/*
 * ============================================================
 * GITHUB API
 * ============================================================
 *
 * Usa il Git Trees API.
 *
 * Con una sola richiesta possiamo ottenere l'albero del repository
 * e filtrare tutti i file che si trovano sotto IMAGE_ROOT.
 *
 * Per repository pubblici non è necessario un token.
 */

 async function findImages() {

  const url =
    `${CONFIG.API_URL}/repos/${encodeURIComponent(CONFIG.OWNER)}/` +
    `${encodeURIComponent(CONFIG.REPO)}/git/trees/` +
    `${encodeURIComponent(CONFIG.BRANCH)}?recursive=1`;

  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json"
    }
  });

  if (!response.ok) {

    throw new Error(
      `GitHub API HTTP ${response.status}. ` +
      "Controlla OWNER, REPO e BRANCH."
    );
  }

  const data = await response.json();

  if (data.truncated) {

    console.warn(
      "GitHub ha restituito un tree troncato. " +
      "Per repository molto grandi conviene usare l'API Contents paginata."
    );
  }

  const root = normalizePath(CONFIG.IMAGE_ROOT);

  return data.tree

    .filter(item => item.type === "blob")

    .filter(
      item =>
        normalizePath(item.path).startsWith(root + "/")
    )

    .filter(item => isImageFile(item.path))

    .map(item => {

      const path = normalizePath(item.path);

      const relative =
        path.substring(root.length + 1);

      const parts = relative.split("/");

      return {

        name: parts[parts.length - 1],

        path: path,

        folder:
          parts.length > 1
            ? parts[0]
            : "",

        sha: item.sha,

   /*     url:
          `https://raw.githubusercontent.com/` +
          `${CONFIG.OWNER}/` +
          `${CONFIG.REPO}/` +
          `${CONFIG.BRANCH}/` +
          `${encodeURI(path)}`
          */

        url:
          `https://raw.githubusercontent.com/` +
          `${CONFIG.OWNER}/` +
          `${CONFIG.REPO}/` +
          `${CONFIG.BRANCH}/` +
          item.path
            .split("/")
            .map(encodeURIComponent)
            .join("/")
          
      };

    })

    .sort((a, b) => {

      const folderCompare =
        a.folder.localeCompare(
          b.folder,
          "it"
        );

      if (folderCompare !== 0) {
        return folderCompare;
      }

      return a.name.localeCompare(
        b.name,
        "it"
      );

    });
} 

/* TEST A */
/*
async function findImages() {

  const url =
    `${CONFIG.API_URL}/repos/${CONFIG.OWNER}/${CONFIG.REPO}` +
    `/git/trees/${CONFIG.BRANCH}?recursive=1`;

  console.log("GitHub API URL:", url);

  const response = await fetch(url);

  console.log("GitHub HTTP status:", response.status);

  if (!response.ok) {
    throw new Error(
      `GitHub API HTTP ${response.status}`
    );
  }

  const data = await response.json();

  console.log("GitHub tree:", data);

  const root = CONFIG.IMAGE_ROOT.replace(
    /^\/+|\/+$/g,
    ""
  );

  const images = data.tree
    .filter(item => item.type === "blob")
    .filter(item =>
      item.path.startsWith(root + "/")
    )
    .filter(item =>
      /\.(png|jpg|jpeg|webp|gif)$/i.test(item.path)
    )
    .map(item => {

      return {
        name: item.path.split("/").pop(),

        path: item.path,

        folder:
          item.path
            .substring(root.length + 1)
            .split("/")[0],

       url:
          `https://raw.githubusercontent.com/` +
          `${CONFIG.OWNER}/` +
          `${CONFIG.REPO}/` +
          `${CONFIG.BRANCH}/` +
          item.path 


        
      };

    });

  console.log("IMMAGINI TROVATE:", images);

  return images;
} */
/* TEST A EOF */

function normalizePath(path) {

  return path.replace(
    /^\/+|\/+$/g,
    ""
  );

}


function isImageFile(path) {

  return /\.(png|jpe?g|webp|gif)$/i.test(
    path
  );

}


/*
 * ============================================================
 * CREAZIONE DELLA GALLERY
 * ============================================================
 *
 * Le immagini vengono inserite immediatamente nel DOM.
 *
 * Il risultato OCR arriverà successivamente.
 */

function renderGallery(images) {

  gallery.innerHTML = "";

  images.forEach((image, index) => {

    const card =
      document.createElement("article");

    card.className = "card";

    card.dataset.index = index;

    card.innerHTML = `

      <div
        class="card-image-wrap"
        title="Apri la locandina"
      >

        <img
          class="card-image"
          src="${escapeAttribute(image.url)}"
          alt="Locandina ${escapeHtml(image.name)}"
          loading="lazy"
        >

        <span class="month-badge">
          ${escapeHtml(
            image.folder || "Eventi"
          )}
        </span>

      </div>


      <div class="card-body">

        <h2 class="event-title">
          Analisi della locandina…
        </h2>

        <div class="event-date">
          Data: —
        </div>

        <div class="ocr-status">
          OCR in attesa…
        </div>

        <div class="ocr-text"></div>

        <div class="file-name">
          ${escapeHtml(image.name)}
        </div>

      </div>

    `;


    card
      .querySelector(".card-image-wrap")
      .addEventListener(
        "click",
        () => {

          state.currentIndex = index;

          showCarousel();

        }
      );


    gallery.appendChild(card);

  });

}


/*
 * ============================================================
 * OCR TESSERACT
 * ============================================================
 *
 * Le immagini vengono analizzate una alla volta.
 *
 * Questo evita di creare contemporaneamente molti worker
 * Tesseract e di bloccare il browser.
 */

async function processOCRSequentially(images) {

  let completed = 0;


  for (
    const [index, image]
    of images.entries()
  ) {

    updateCardStatus(
      index,
      "OCR in corso…"
    );


    try {

      const result =
        await Tesseract.recognize(

          image.url,

          CONFIG.OCR_LANGUAGE,

          {

            logger: message => {

              if (
                message.status ===
                  "recognizing text" &&
                message.progress
              ) {

                const percent =
                  Math.round(
                    message.progress * 100
                  );

                updateCardStatus(
                  index,
                  `OCR in corso… ${percent}%`
                );

              }

            }

          }

        );


    /*  const text =
        cleanOCR(
          result.data.text
        ); */
/*
 * TESTO OCR ORIGINALE
 */
const ocrOriginal =
  result.data.text;


/*
 * Pulizia generale.
 */
let text =
  cleanOCR(
    ocrOriginal
  );


/*
 * Correzione specifica FVG.
 */
text =
  fvgCorrectOCRText(
    text
  );


console.log(
  "OCR originale:",
  ocrOriginal
);

console.log(
  "OCR elaborato:",
  text
);


      const info =
        extractEventInfo(
          text,
          image.folder
        );


      state.ocrResults.set(
        index,
        {

          text: text,

          title: info.title,

          date: info.date

        }
      );


      updateCard(
        index,
        info,
        text
      );


    } catch (error) {

      console.error(
        "OCR error:",
        image.path,
        error
      );


      state.ocrResults.set(
        index,
        {

          text: "",

          title:
            "Locandina evento",

          date:
            "Data non riconosciuta"

        }
      );


      updateCard(

        index,

        {

          title:
            "Locandina evento",

          date:
            "Data non riconosciuta"

        },

        "Impossibile leggere il testo automaticamente."

      );

    }


    completed++;


    setStatus(
      `Analisi OCR: ${completed}/${images.length}`
    );

  }


  setStatus(

    `Completato. ${images.length} locandin` +
    `${images.length === 1 ? "a" : "e"} analizzate.`

  );


  if (
    !carousel.classList.contains(
      "hidden"
    )
  ) {

    renderCarousel();

  }

}


/*
 * ============================================================
 * AGGIORNAMENTO CARD
 * ============================================================
 */

function updateCardStatus(
  index,
  text
) {

  const card =
    gallery.querySelector(
      `[data-index="${index}"]`
    );


  if (!card) {
    return;
  }


  card
    .querySelector(".ocr-status")
    .textContent = text;

}


function updateCard(
  index,
  info,
  text
) {

  const card =
    gallery.querySelector(
      `[data-index="${index}"]`
    );


  if (!card) {
    return;
  }


  card
    .querySelector(".event-title")
    .textContent =
      info.title ||
      "Locandina evento";


  card
    .querySelector(".event-date")
    .textContent =
      info.date
        ? `📅 ${info.date}`
        : "📅 Data non riconosciuta";


  card
    .querySelector(".ocr-status")
    .textContent =
      "✓ OCR completato";


  card
    .querySelector(".ocr-text")
    .textContent =
      text ||
      "Nessun testo riconosciuto.";

}


/*
 * ============================================================
 * RICONOSCIMENTO EVENTO
 * ============================================================
 */

function extractEventInfo(
  text,
  folder
) {

  const lines =
    text

      .split(/\r?\n/)

      .map(
        line =>
          line
            .replace(/\s+/g, " ")
            .trim()
      )

      .filter(
        line =>
          line.length >= 3
      );


  const date =
    findDate(lines);


  const title =
    findTitle(
      lines,
      date
    );


  return {

    title:
      title ||
      prettifyFolder(folder) ||
      "Evento / Sagra",

    date:
      date ||
      "Data non riconosciuta"

  };

}


/*
 * ============================================================
 * RICERCA DATA
 * ============================================================
 */

function findDate(lines) {

  const text =
    lines.join(" ");


  const monthPattern =
    "(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)";


  const numeric =
    /\b([0-3]?\d)[\/.\-]([0-1]?\d)[\/.\-](20\d{2})\b/i;


  const numericShort =
    /\b([0-3]?\d)[\/.\-]([0-1]?\d)\b/i;


  const monthDate =
    new RegExp(

      `\\b([0-3]?\\d)\\s+` +
      `(?:di\\s+)?` +
      `${monthPattern}` +
      `\\s+(20\\d{2})?\\b`,

      "i"

    );


  let match =
    text.match(
      numeric
    );


  if (match) {

    return (
      `${match[1].padStart(2, "0")}/` +
      `${match[2].padStart(2, "0")}/` +
      `${match[3]}`
    );

  }


  match =
    text.match(
      monthDate
    );


  if (match) {

    return (
      `${match[1]} ` +
      `${match[2]}` +
      `${match[3] ? " " + match[3] : ""}`
    );

  }


  match =
    text.match(
      numericShort
    );


  if (match) {

    return (
      `${match[1].padStart(2, "0")}/` +
      `${match[2].padStart(2, "0")}`
    );

  }


  return "";

}


/*
 * ============================================================
 * RICERCA TITOLO
 * ============================================================
 */

function findTitle(
  lines,
  date
) {

  const ignored = [

    "friuli venezia giulia",

    "friuli",

    "venezia giulia",

    "programma",

    "ingresso",

    "info",

    "informazioni",

    "www",

    "facebook",

    "instagram",

    "comune di",

    "pro loco"

  ];


  const candidates =

    lines

      .filter(
        line =>
          line.length >= 5 &&
          line.length <= 90
      )

      .filter(
        line =>
          !/^\d+$/.test(line)
      )

      .filter(
        line =>
          !looksLikeDate(line)
      )

      .filter(
        line =>
          !ignored.some(
            word =>
              line
                .toLowerCase() === word
          )
      )

      .filter(
        line =>
          !/^https?:\/\//i.test(line)
      )

.map(
  line => {

    const fvg =
      fvgAnalyzeLine(line);

    return {

      line: line,

      score:
        titleScore(line) +
        fvg.score

    };

  }
)

      .sort(
        (a, b) =>
          b.score - a.score
      );


  if (
    !candidates.length
  ) {

    return "";

  }


  return candidates[0].line;

}


/*
 * ============================================================
 * PUNTEGGIO TITOLO
 * ============================================================
 */

function titleScore(line) {

  let score = 0;


  if (
    line.length >= 8 &&
    line.length <= 55
  ) {

    score += 3;

  }


  const letters =
    line.match(
      /[A-Za-zÀ-ÖØ-öø-ÿ]/g
    ) || [];


  const upper =
    line.match(
      /[A-ZÀ-ÖØ-Þ]/g
    ) || [];


  if (
    letters.length > 0
  ) {

    const ratio =
      upper.length /
      letters.length;


    if (ratio > 0.65) {

      score += 5;

    } else if (
      ratio > 0.45
    ) {

      score += 3;

    }

  }


  if (
    /\b(sagra|festa|festeggiamenti|fiera|mostra|festival|mercato|palio|rassegna)\b/i
      .test(line)
  ) {

    score += 8;

  }


  if (
    /@|www\.|\.it\b|tel\.?|cell\.?/i
      .test(line)
  ) {

    score -= 8;

  }


  return score;

}


/*
 * ============================================================
 * VERIFICA DATA
 * ============================================================
 */

function looksLikeDate(line) {

  return (

    /\b\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?\b/
      .test(line)

    ||

    /\b\d{1,2}\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/i
      .test(line)

  );

}


/*
 * ============================================================
 * NOME CARTELLA
 * ============================================================
 */

function prettifyFolder(folder) {

  if (!folder) {
    return "";
  }


  return folder

    .replace(
      /[-_]+/g,
      " "
    )

    .replace(
      /\b\w/g,
      char =>
        char.toUpperCase()
    );

}


/*
 * ============================================================
 * CAROSELLO
 * ============================================================
 */

function showCarousel() {

  gallery.classList.add(
    "hidden"
  );

  carousel.classList.remove(
    "hidden"
  );


  gridButton.classList.remove(
    "active"
  );

  carouselButton.classList.add(
    "active"
  );


  renderCarousel();

}


function showGrid() {

  carousel.classList.add(
    "hidden"
  );

  gallery.classList.remove(
    "hidden"
  );


  carouselButton.classList.remove(
    "active"
  );

  gridButton.classList.add(
    "active"
  );

}


function renderCarousel() {

  const image =
    state.images[
      state.currentIndex
    ];


  if (!image) {
    return;
  }


  const result =
    state.ocrResults.get(
      state.currentIndex
    );


  const title =
    result?.title ||
    "Analisi OCR in corso…";


  const date =
    result?.date ||
    "—";


  const text =
    result?.text ||
    "Tesseract sta leggendo la locandina…";


  carouselContent.innerHTML = `

    <article class="carousel-card">

      <img
        class="carousel-image"
        src="${escapeAttribute(image.url)}"
        alt="${escapeAttribute(title)}"
      >

      <div class="carousel-info">

        <div class="month-badge">
          ${escapeHtml(
            image.folder || "Evento"
          )}
        </div>

        <h2 class="event-title">
          ${escapeHtml(title)}
        </h2>

        <div class="event-date">
          📅 ${escapeHtml(date)}
        </div>

        <p>
          <strong>
            Testo riconosciuto automaticamente:
          </strong>
        </p>

        <div class="ocr-text">
          ${escapeHtml(text)}
        </div>

        <div class="file-name">
          ${escapeHtml(image.path)}
        </div>

      </div>

    </article>

  `;

}


/*
 * ============================================================
 * NAVIGAZIONE CAROSELLO
 * ============================================================
 */

prevButton.addEventListener(
  "click",
  () => {

    if (!state.images.length) {
      return;
    }


    state.currentIndex =

      (
        state.currentIndex -
        1 +
        state.images.length
      )

      %

      state.images.length;


    renderCarousel();

  }
);


nextButton.addEventListener(
  "click",
  () => {

    if (!state.images.length) {
      return;
    }


    state.currentIndex =

      (
        state.currentIndex +
        1
      )

      %

      state.images.length;


    renderCarousel();

  }
);


gridButton.addEventListener(
  "click",
  showGrid
);


carouselButton.addEventListener(
  "click",
  showCarousel
);


document.addEventListener(
  "keydown",
  event => {

    if (
      carousel.classList.contains(
        "hidden"
      )
    ) {

      return;

    }


    if (
      event.key === "ArrowLeft"
    ) {

      prevButton.click();

    }


    if (
      event.key === "ArrowRight"
    ) {

      nextButton.click();

    }


    if (
      event.key === "Escape"
    ) {

      showGrid();

    }

  }
);


/*
 * ============================================================
 * UTILITY
 * ============================================================
 */

function cleanOCR(text) {

  return text

    .replace(
      /\r/g,
      ""
    )

    .replace(
      /[ \t]+/g,
      " "
    )

    .replace(
      /\n{3,}/g,
      "\n\n"
    )

    .trim();

}


function setStatus(message) {

  statusBox.textContent =
    message;

  statusBox.classList.remove(
    "error"
  );

}


function showError(message) {

  statusBox.textContent =
    message;

  statusBox.classList.add(
    "error"
  );

}


function escapeHtml(value) {

  return String(value)

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    )

    .replaceAll(
      "'",
      "&#039;"
    );

}


function escapeAttribute(value) {

  return escapeHtml(value);

}
