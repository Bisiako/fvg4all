/* =====================================================================
   CONFIGURAZIONE
   Se il sito è su username.github.io/nome-repo/, owner e repo vengono
   rilevati da soli. Se il rilevamento sbaglia (es. dominio personalizzato),
   scrivi qui i valori giusti a mano.
   ===================================================================== */
const CONFIG = {
  owner: null,          // es. "marcorossi" — null = auto-rilevato
  repo: null,           // es. "diario-foto" — null = auto-rilevato
  branch: "main",
  imagesRoot: "images", // cartella che contiene le sottocartelle-mese
  ocrLang: "ita",       // lingua per Tesseract.js
};

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;

function detectRepoInfo() {
  if (CONFIG.owner && CONFIG.repo) return { owner: CONFIG.owner, repo: CONFIG.repo };
  const host = location.hostname; // es. marcorossi.github.io
  const owner = host.endsWith(".github.io") ? host.replace(".github.io", "") : null;
  const pathParts = location.pathname.split("/").filter(Boolean);
  const repo = pathParts.length > 0 ? pathParts[0] : `${owner}.github.io`;
  return { owner, repo };
}

const REPO = detectRepoInfo();

/* =====================================================================
   ACCESSO AI DATI TRAMITE GITHUB CONTENTS API
   GitHub Pages è statico e non offre un elenco di cartelle: usiamo
   quindi l'API pubblica di GitHub per leggere il contenuto della
   repository al volo. Le risposte vengono messe in cache in
   sessionStorage per limitare le chiamate (l'API non autenticata
   consente circa 60 richieste/ora per IP).
   ===================================================================== */
async function fetchRepoDir(path) {
  const cacheKey = `ghdir:${REPO.owner}/${REPO.repo}/${path}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${path}?ref=${CONFIG.branch}`;
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? "Limite di richieste GitHub raggiunto, riprova tra qualche minuto."
        : `Impossibile leggere "${path}" (HTTP ${res.status}).`
    );
  }
  const data = await res.json();
  sessionStorage.setItem(cacheKey, JSON.stringify(data));
  return data;
}

async function listMonths() {
  const entries = await fetchRepoDir(CONFIG.imagesRoot);
  return entries
    .filter((e) => e.type === "dir")
    .map((e) => e.name)
    .sort()
    .reverse(); // mese più recente prima
}

async function listImagesInMonth(month) {
  const entries = await fetchRepoDir(`${CONFIG.imagesRoot}/${month}`);
  return entries
    .filter((e) => e.type === "file" && IMAGE_EXT.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ name: e.name, url: e.download_url }));
}

/* =====================================================================
   OCR — Tesseract.js, un solo worker riutilizzato, con cache in
   localStorage per non ri-leggere la stessa immagine ad ogni visita.
   ===================================================================== */
let ocrWorkerPromise = null;
function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = Tesseract.createWorker(CONFIG.ocrLang);
  }
  return ocrWorkerPromise;
}

function ocrCacheKey(month, filename) {
  return `ocr:${REPO.owner}/${REPO.repo}/${month}/${filename}`;
}

async function readImageText(month, image, onText) {
  const key = ocrCacheKey(month, image.name);
  const cached = localStorage.getItem(key);
  if (cached !== null) {
    onText(cached);
    return;
  }
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(image.url);
    const text = (data.text || "").trim();
    localStorage.setItem(key, text);
    onText(text);
  } catch (err) {
    console.error("OCR fallito per", image.name, err);
    onText("");
  }
}

/* Esegue l'OCR solo quando il riquadro entra nello schermo, per non
   analizzare decine di immagini tutte insieme. */
const lazyOcrObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      lazyOcrObserver.unobserve(el);
      const { month, name, url } = el.dataset;
      readImageText(month, { name, url }, (text) => {
        const target = el.querySelector("[data-role=text]");
        if (!target) return;
        target.textContent = text || "Nessun testo riconosciuto.";
        target.classList.remove("is-pending");
        if (!text) target.classList.add("is-empty");
      });
    }
  },
  { rootMargin: "200px" }
);

/* =====================================================================
   STATO E RENDER
   ===================================================================== */
const state = {
  months: [],
  currentMonth: null,
  images: [],
  view: "grid",
  carouselIndex: 0,
};

const els = {
  months: document.getElementById("months"),
  monthLabel: document.getElementById("current-month"),
  countLabel: document.getElementById("current-count"),
  grid: document.getElementById("grid-view"),
  carousel: document.getElementById("carousel-view"),
  carouselFrame: document.getElementById("carousel-frame"),
  carouselIndex: document.getElementById("carousel-index"),
  carouselPrev: document.getElementById("carousel-prev"),
  carouselNext: document.getElementById("carousel-next"),
  empty: document.getElementById("empty-state"),
};

function renderMonthTabs() {
  els.months.innerHTML = "";
  if (state.months.length === 0) {
    els.months.innerHTML = '<p class="months__hint">Nessuna cartella-mese trovata in "images/".</p>';
    return;
  }
  for (const month of state.months) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "month-tab" + (month === state.currentMonth ? " is-active" : "");
    btn.innerHTML = `<span>${formatMonthLabel(month)}</span>`;
    btn.addEventListener("click", () => selectMonth(month));
    els.months.appendChild(btn);
  }
}

function formatMonthLabel(month) {
  // accetta cartelle tipo "2026-09" e le mostra come "Settembre 2026"
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const names = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  const [, year, m] = match;
  return `${names[parseInt(m, 10) - 1]} ${year}`;
}

async function selectMonth(month) {
  state.currentMonth = month;
  state.carouselIndex = 0;
  renderMonthTabs();
  els.monthLabel.textContent = formatMonthLabel(month);
  els.countLabel.textContent = "caricamento…";
  els.grid.innerHTML = "";
  els.carouselFrame.innerHTML = "";
  els.empty.hidden = true;

  try {
    state.images = await listImagesInMonth(month);
  } catch (err) {
    els.countLabel.textContent = "";
    els.empty.hidden = false;
    els.empty.textContent = err.message;
    return;
  }

  els.countLabel.textContent = `${state.images.length} immagine${state.images.length === 1 ? "" : "i"}`;
  els.empty.hidden = state.images.length > 0;
  renderGrid();
  renderCarousel();
}

function renderGrid() {
  els.grid.innerHTML = "";
  for (const image of state.images) {
    const frame = document.createElement("article");
    frame.className = "frame";
    frame.dataset.month = state.currentMonth;
    frame.dataset.name = image.name;
    frame.dataset.url = image.url;
    frame.innerHTML = `
      <div class="frame__img-wrap">
        <img src="${image.url}" alt="Immagine ${image.name}" loading="lazy">
      </div>
      <div class="frame__caption">
        <span class="frame__filename">${image.name}</span>
        <p class="frame__text is-pending" data-role="text">Lettura del testo…</p>
      </div>`;
    els.grid.appendChild(frame);
    lazyOcrObserver.observe(frame);
  }
}

function renderCarousel() {
  if (state.images.length === 0) {
    els.carouselFrame.innerHTML = "";
    els.carouselIndex.textContent = "";
    return;
  }
  const image = state.images[state.carouselIndex];
  els.carouselFrame.innerHTML = `
    <img src="${image.url}" alt="Immagine ${image.name}">
    <div class="carousel__caption">
      <span class="carousel__filename">${image.name}</span>
      <p class="carousel__text is-pending" data-role="text">Lettura del testo…</p>
    </div>`;
  els.carouselIndex.textContent = `${state.carouselIndex + 1} / ${state.images.length}`;

  readImageText(state.currentMonth, image, (text) => {
    const target = els.carouselFrame.querySelector("[data-role=text]");
    if (!target) return;
    target.textContent = text || "Nessun testo riconosciuto.";
    target.classList.remove("is-pending");
  });
}

function moveCarousel(delta) {
  if (state.images.length === 0) return;
  state.carouselIndex = (state.carouselIndex + delta + state.images.length) % state.images.length;
  renderCarousel();
}

function setView(view) {
  state.view = view;
  els.grid.hidden = view !== "grid";
  els.carousel.hidden = view !== "carousel";
  document.querySelectorAll(".view-toggle__btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === view);
  });
}

/* =====================================================================
   AVVIO
   ===================================================================== */
document.querySelectorAll(".view-toggle__btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});
els.carouselPrev.addEventListener("click", () => moveCarousel(-1));
els.carouselNext.addEventListener("click", () => moveCarousel(1));
document.addEventListener("keydown", (e) => {
  if (state.view !== "carousel") return;
  if (e.key === "ArrowLeft") moveCarousel(-1);
  if (e.key === "ArrowRight") moveCarousel(1);
});

(async function init() {
  if (!REPO.owner || !REPO.repo) {
    els.months.innerHTML = '<p class="months__hint">Imposta owner/repo in js/app.js.</p>';
    return;
  }
  try {
    state.months = await listMonths();
  } catch (err) {
    els.months.innerHTML = `<p class="months__hint">${err.message}</p>`;
    return;
  }
  renderMonthTabs();
  if (state.months.length > 0) {
    await selectMonth(state.months[0]);
  } else {
    els.countLabel.textContent = "";
  }
})();
