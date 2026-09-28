const CONFIG = {
  OWNER: "Bisiako",
  REPO: "fvg4all",
  BRANCH: "main",

  // Percorso nel repository.
  // Se le immagini sono realmente in main/images/, lascia così.
  IMAGE_ROOT: "images",

  API_URL: "https://api.github.com",

  // ------------------------------------------------------------
  // OCR con Florence-2 (Hugging Face transformers.js), via CDN.
  // ------------------------------------------------------------
  // Modello ONNX pronto per il browser. "base-ft" è più leggero
  // (~230M parametri); per maggiore precisione si può passare a
  // "onnx-community/Florence-2-large-ft" (più pesante da scaricare).
  OCR_MODEL_ID: "onnx-community/Florence-2-base-ft",

  // Task Florence-2 che restituisce testo + bounding box (quad_boxes).
  OCR_TASK: "<OCR_WITH_REGION>",

  // Quantizzazione per sotto-modello di Florence-2.
  // q8 su encoder/decoder (la parte più grande e robusta);
  // vision_encoder ed embed_tokens restano a precisione più alta
  // perché con q8 uniforme il modello generava subito il token di
  // fine e restituiva testo vuoto.
  OCR_DTYPE_WEBGPU: {
    embed_tokens: "fp16",
    vision_encoder: "fp16",
    encoder_model: "q8",
    decoder_model_merged: "q8"
  },

  // Fallback WASM/CPU: fp16 non è supportato, quindi fp32.
  OCR_DTYPE_WASM: {
    embed_tokens: "fp32",
    vision_encoder: "fp32",
    encoder_model: "q8",
    decoder_model_merged: "q8"
  },

  // Preset di DIAGNOSTICA, selezionabili dall'URL della pagina:
  //   ?ocr=fp32            tutto a precisione piena (baseline, ~1 GB)
  //   ?ocr=fp16            tutto fp16 (solo WebGPU)
  //   ?ocr=demo            combinazione della demo ufficiale HF
  //   ?ocr=q8              q8 uniforme
  //   &device=wasm|webgpu  forza il backend di calcolo
  // Esempio: index.html?ocr=fp32&device=wasm
  OCR_PRESETS: {
    fp32: "fp32",
    fp16: "fp16",
    q8: "q8",
    demo: {
      embed_tokens: "fp16",
      vision_encoder: "fp16",
      encoder_model: "q4",
      decoder_model_merged: "q4"
    }
  },

  // Versione di @huggingface/transformers caricata da jsDelivr.
  TRANSFORMERS_CDN_URL:
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5"
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
      "Caricamento del modello AI per l'OCR (Florence-2)… " +
      "al primo avvio può richiedere qualche minuto."
    );

    await ensureFlorenceEngine();

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

      updateCardStatus(
        index,
        "OCR in corso (Florence-2)…"
      );

      const ocrOriginal =
        await recognizeWithFlorence(
          image.url
        );

      console.log(
        "Florence-2 · testo ricostruito dalle region:",
        image.name,
        ocrOriginal
      );


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
 * OCR CON FLORENCE-2 (Hugging Face transformers.js via CDN)
 * ============================================================
 *
 * Il modello viene scaricato e inizializzato una sola volta
 * (viene poi tenuto in cache dal browser). Si tenta prima
 * l'esecuzione su WebGPU; se non disponibile si passa
 * automaticamente al fallback WASM.
 */

let florenceModulePromise = null;
let florenceEnginePromise = null;

function loadTransformersModule() {

  if (!florenceModulePromise) {

    florenceModulePromise = import(
      /* webpackIgnore: true */
      CONFIG.TRANSFORMERS_CDN_URL
    );

  }

  return florenceModulePromise;

}

function ensureFlorenceEngine() {

  if (!florenceEnginePromise) {

    florenceEnginePromise = (async () => {

      const {
        Florence2ForConditionalGeneration,
        AutoProcessor
      } = await loadTransformersModule();

      const modelId = CONFIG.OCR_MODEL_ID;

      const reportProgress = info => {

        if (info.status === "progress" && info.file) {

          const percent =
            info.total
              ? Math.round((info.loaded / info.total) * 100)
              : null;

          setStatus(
            percent !== null
              ? `Download modello AI: ${info.file} (${percent}%)`
              : `Download modello AI: ${info.file}…`
          );

        }

      };

      // Parametri opzionali da URL per la diagnostica.
      const params = new URLSearchParams(window.location.search);
      const presetName = params.get("ocr");
      const forcedDevice = params.get("device");

      const preset =
        presetName && CONFIG.OCR_PRESETS[presetName]
          ? CONFIG.OCR_PRESETS[presetName]
          : null;

      const loadModel = async device => {

        const dtype =
          preset ||
          (device === "webgpu"
            ? CONFIG.OCR_DTYPE_WEBGPU
            : CONFIG.OCR_DTYPE_WASM);

        console.log(
          "Florence-2 · configurazione modello → device:",
          device,
          "| dtype:",
          dtype,
          "| preset URL:",
          presetName || "(nessuno)"
        );

        const options = {
          dtype,
          progress_callback: reportProgress
        };

        // Per "wasm" non si passa device: è il default di transformers.js.
        if (device === "webgpu") {
          options.device = "webgpu";
        }

        return Florence2ForConditionalGeneration.from_pretrained(
          modelId,
          options
        );

      };

      let model;

      if (forcedDevice === "wasm") {

        model = await loadModel("wasm");

      } else {

        try {

          model = await loadModel("webgpu");

        } catch (webgpuError) {

          console.warn(
            "WebGPU non disponibile, uso il fallback WASM:",
            webgpuError
          );

          model = await loadModel("wasm");

        }

      }

      const processor =
        await AutoProcessor.from_pretrained(modelId);

      return { model, processor };

    })();

  }

  return florenceEnginePromise;

}

async function recognizeWithFlorence(imageUrl) {

  const { load_image } = await loadTransformersModule();

  const { model, processor } =
    await ensureFlorenceEngine();

  console.log(
    "Florence-2 · [1/5] carico l'immagine:",
    imageUrl
  );

  let image;

  for (let attempt = 1; attempt <= 3; attempt++) {

    try {

      image = await load_image(imageUrl);
      break;

    } catch (loadError) {

      console.warn(
        `Florence-2 · caricamento immagine fallito (tentativo ${attempt}/3):`,
        imageUrl,
        loadError
      );

      if (attempt === 3) {
        throw loadError;
      }

      await new Promise(resolve =>
        setTimeout(resolve, 800 * attempt)
      );

    }

  }

  console.log(
    "Florence-2 · [2/5] immagine caricata, dimensioni:",
    image.width,
    "x",
    image.height,
    "| image.size:",
    image.size
  );

  const task = CONFIG.OCR_TASK;

  const prompts = processor.construct_prompts(task);

  console.log(
    "Florence-2 · [3/5] task:",
    task,
    "| prompt costruito:",
    prompts
  );

  const inputs = await processor(image, prompts);

  console.log(
    "Florence-2 · [3/5] chiavi di 'inputs' passate al modello:",
    Object.keys(inputs)
  );

  const generatedIds = await model.generate({
    ...inputs,
    max_new_tokens: 512
  });

  console.log(
    "Florence-2 · [4/5] generatedIds:",
    generatedIds,
    "| dims:",
    generatedIds?.dims
  );

  if (generatedIds?.dims && generatedIds.dims[1] <= 3) {

    console.warn(
      "Florence-2 · il modello ha generato solo token speciali " +
      "(nessun testo). Controlla OCR_DTYPE_WEBGPU / OCR_DTYPE_WASM " +
      "in CONFIG: la quantizzazione di vision_encoder/embed_tokens " +
      "può azzerare l'output."
    );

  }

  const generatedText =
    processor.batch_decode(generatedIds, {
      skip_special_tokens: false
    })[0];

  console.log(
    "Florence-2 · [4/5] testo grezzo generato (lunghezza " +
      (generatedText ? generatedText.length : 0) +
      "):",
    generatedText
  );

  const parsed =
    processor.post_process_generation(
      generatedText,
      task,
      image.size
    );

  console.log(
    "Florence-2 · [5/5] risultato post-process completo:",
    parsed
  );

  console.log(
    "Florence-2 · [5/5] parsed[" + task + "]:",
    parsed ? parsed[task] : undefined
  );

  const regionResult =
    parsed && parsed[task]
      ? parsed[task]
      : parsed && Object.values(parsed)[0];

  const text = regionResultToText(regionResult);

  console.log(
    "Florence-2 · testo finale ricostruito:",
    JSON.stringify(text)
  );

  return text;

}

/*
 * Converte l'output OCR_WITH_REGION (quad_boxes + labels) in un
 * testo semplice, ricostruendo l'ordine di lettura riga per riga
 * in base alla posizione verticale/orizzontale dei riquadri.
 */
function regionResultToText(regionResult) {

  if (
    !regionResult ||
    !Array.isArray(regionResult.quad_boxes)
  ) {

    return "";

  }

  const items = regionResult.quad_boxes

    .map((box, i) => {

      const xs = [box[0], box[2], box[4], box[6]];
      const ys = [box[1], box[3], box[5], box[7]];

      return {

        text:
          (regionResult.labels[i] || "")
            .replace(/<\/?s>/g, "")
            .trim(),

        x: xs.reduce((a, b) => a + b, 0) / 4,
        y: ys.reduce((a, b) => a + b, 0) / 4,
        height: Math.max(...ys) - Math.min(...ys)

      };

    })

    .filter(item => item.text.length > 0);

  if (!items.length) {
    return "";
  }

  items.sort((a, b) => a.y - b.y);

  const avgHeight =
    items.reduce((sum, it) => sum + it.height, 0) /
    items.length;

  const rowThreshold = Math.max(10, avgHeight * 0.6);

  const lines = [];

  items.forEach(item => {

    const currentLine = lines[lines.length - 1];

    if (
      currentLine &&
      Math.abs(item.y - currentLine.y) <= rowThreshold
    ) {

      currentLine.items.push(item);
      currentLine.y = (currentLine.y + item.y) / 2;

    } else {

      lines.push({ y: item.y, items: [item] });

    }

  });

  return lines

    .map(line =>
      line.items
        .sort((a, b) => a.x - b.x)
        .map(item => item.text)
        .join(" ")
    )

    .join("\n");

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
