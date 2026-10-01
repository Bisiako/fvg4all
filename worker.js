// worker.js — esegue l'inferenza TrOCR (Transformers.js) fuori dal thread principale.
// Caricato come modulo: new Worker('worker.js', { type: 'module' })

import {
  pipeline,
  env,
  Florence2ForConditionalGeneration,
  AutoProcessor,
  AutoTokenizer,
  RawImage,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm';

// Non cercare mai modelli locali: sempre dal CDN/hub HuggingFace (cache automatica del browser)
env.allowLocalModels = false;

// Usa tutti i core disponibili sul dispositivo per il backend WASM (CPU).
// Nota: senza header COOP/COEP (crossOriginIsolated) il browser ignora comunque
// questo valore e usa un singolo thread — è solo un warning, non un errore.
try {
  env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;
} catch (_) {
  // ignorato se la proprietà non è disponibile in questa build
}

// ---------- TrOCR: recognition di una singola riga di testo ----------
// Cache delle pipeline già istanziate: stessa combinazione modello+dtype+device
// non viene ricaricata due volte (dopo il primo download è servita da IndexedDB/Cache API)
const trocrCache = new Map();

async function getTrOCRPipeline(modelId, dtype, device) {
  const key = `${modelId}|${dtype}|${device}`;
  if (!trocrCache.has(key)) {
    const pipe = await pipeline('image-to-text', modelId, { dtype, device });
    trocrCache.set(key, pipe);
  }
  return trocrCache.get(key);
}

async function runTrOCR({ imageDataUrl, modelId, dtype, device }) {
  const t0 = performance.now();
  const pipe = await getTrOCRPipeline(modelId, dtype, device);
  const tLoaded = performance.now();
  const output = await pipe(imageDataUrl);
  const tDone = performance.now();
  return {
    text: output?.[0]?.generated_text ?? '',
    loadMs: Math.round(tLoaded - t0),
    inferMs: Math.round(tDone - tLoaded),
    totalMs: Math.round(tDone - t0),
  };
}

// ---------- Florence-2: vision-language model, task <OCR> sull'intera immagine ----------
// A differenza di TrOCR, capisce immagini con più blocchi di testo in punti diversi
// (titoli, date, loghi) senza bisogno di un passaggio di detection separato.
let florenceState = null; // { key, model, processor, tokenizer }

async function getFlorence(modelId, dtype, device) {
  const key = `${modelId}|${dtype}|${device}`;
  if (!florenceState || florenceState.key !== key) {
    const model = await Florence2ForConditionalGeneration.from_pretrained(modelId, { dtype, device });
    const processor = await AutoProcessor.from_pretrained(modelId);
    const tokenizer = await AutoTokenizer.from_pretrained(modelId);
    florenceState = { key, model, processor, tokenizer };
  }
  return florenceState;
}

async function runFlorence({ imageDataUrl, modelId, dtype, device, task }) {
  const t0 = performance.now();
  const { model, processor, tokenizer } = await getFlorence(modelId, dtype, device);
  const tLoaded = performance.now();

  const image = await RawImage.fromURL(imageDataUrl);
  const vision_inputs = await processor(image);
  const prompts = processor.construct_prompts(task);
  const text_inputs = tokenizer(prompts);

  const generated_ids = await model.generate({
    ...text_inputs,
    ...vision_inputs,
    max_new_tokens: 512,
  });
  const generated_text = tokenizer.batch_decode(generated_ids, { skip_special_tokens: false })[0];
  const result = processor.post_process_generation(generated_text, task, image.size);
  const tDone = performance.now();

  const raw = result?.[task];
  let text;
  if (task === '<OCR_WITH_REGION>' && raw && Array.isArray(raw.labels)) {
    // <OCR> concatena tutte le porzioni di testo senza spazi/a-capo.
    // <OCR_WITH_REGION> restituisce ogni porzione con il suo riquadro (quad_boxes):
    // le riordiniamo per posizione (alto->basso, poi sinistra->destra) e le separiamo
    // con un a-capo, così il risultato è già leggibile riga per riga.
    const items = raw.labels.map((label, i) => {
      const box = raw.quad_boxes?.[i] ?? [];
      const ys = box.filter((_, idx) => idx % 2 === 1);
      const xs = box.filter((_, idx) => idx % 2 === 0);
      const cy = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
      const cx = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      return { text: label.replace(/^<\/?\w+>/g, '').trim(), cx, cy };
    });
    items.sort((a, b) => (Math.abs(a.cy - b.cy) > 15 ? a.cy - b.cy : a.cx - b.cx));
    text = items.map(it => it.text).filter(Boolean).join('\n');
  } else {
    text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  }

  return {
    text,
    loadMs: Math.round(tLoaded - t0),
    inferMs: Math.round(tDone - tLoaded),
    totalMs: Math.round(tDone - t0),
  };
}

// ---------- RapidOCR / PP-OCR: detection (DB) + recognition (CRNN) scritte a mano ----------
// Non esiste un pacchetto JS ufficiale di RapidOCR caricabile da CDN senza build tool
// (@paddleocr/paddleocr-js richiede esbuild, vedi errore "process.binding").
// Qui usiamo direttamente i pesi ONNX di PP-OCRv4 + onnxruntime-web, con pre/post-processing
// scritto a mano: soglia sulla mappa di probabilità + connected components (bounding box
// assiali, NIENTE rotazione) per la detection, poi CRNN + CTC greedy per la recognition.
// Limiti noti: testo ruotato/curvo (es. "ITALIA" sul cerchio, "R. SLOVENIJA" sulla curva)
// verrà probabilmente ignorato o letto male, perché il detection qui è semplificato
// rispetto all'algoritmo completo di PaddleOCR (che usa poligoni ruotati, non solo bbox).

const ORT_VERSION = '1.20.1';
let ortModulePromise = null;
function getOrt() {
  if (!ortModulePromise) {
    ortModulePromise = import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/+esm`).then((ort) => {
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
      ort.env.wasm.numThreads = 1; // niente crossOriginIsolated qui: singolo thread
      return ort;
    });
  }
  return ortModulePromise;
}

const RAPIDOCR_ASSETS = {
  det: 'https://huggingface.co/pitapo/rapidocr/resolve/main/onnx/PP-OCRv4/det/ch_PP-OCRv4_det_infer.onnx',
  rec: {
    latin: {
      model: 'https://huggingface.co/pitapo/rapidocr/resolve/main/onnx/PP-OCRv4/rec/latin_PP-OCRv3_rec_infer.onnx',
      dict: 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/latin_dict.txt',
    },
    en: {
      model: 'https://huggingface.co/pitapo/rapidocr/resolve/main/onnx/PP-OCRv4/rec/en_PP-OCRv4_rec_infer.onnx',
      dict: 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/en_dict.txt',
    },
  },
};

const rapidCache = { det: null, rec: {} };

async function loadSession(url) {
  const ort = await getOrt();
  return ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
}

async function getDetSession() {
  if (!rapidCache.det) rapidCache.det = await loadSession(RAPIDOCR_ASSETS.det);
  return rapidCache.det;
}

async function getRecSession(lang) {
  if (!rapidCache.rec[lang]) {
    const { model, dict } = RAPIDOCR_ASSETS.rec[lang];
    const [session, dictText] = await Promise.all([
      loadSession(model),
      fetch(dict).then((r) => r.text()),
    ]);
    const chars = dictText.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
    if (chars[chars.length - 1] !== ' ') chars.push(' '); // spazio a fine dizionario, convenzione PaddleOCR
    rapidCache.rec[lang] = { session, chars };
  }
  return rapidCache.rec[lang];
}

async function bitmapFromDataUrl(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

// ---- detection ----
function computeDetShape(w, h, limitSideLen = 960) {
  let ratio = 1;
  if (Math.max(w, h) > limitSideLen) ratio = limitSideLen / Math.max(w, h);
  let resizeW = Math.max(32, Math.round((w * ratio) / 32) * 32);
  let resizeH = Math.max(32, Math.round((h * ratio) / 32) * 32);
  return { resizeW, resizeH, ratioW: resizeW / w, ratioH: resizeH / h };
}

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

function imageDataToNCHW(imgData, mean, std, scale01 = true) {
  const { data, width, height } = imgData;
  const out = new Float32Array(3 * width * height);
  const plane = width * height;
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    out[i] = (r - mean[0]) / std[0];
    out[plane + i] = (g - mean[1]) / std[1];
    out[2 * plane + i] = (b - mean[2]) / std[2];
  }
  return out;
}

async function detectBoxes(bitmap) {
  const ort = await getOrt();
  const session = await getDetSession();
  const { resizeW, resizeH, ratioW, ratioH } = computeDetShape(bitmap.width, bitmap.height);

  const canvas = new OffscreenCanvas(resizeW, resizeH);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, resizeW, resizeH);
  const imgData = ctx.getImageData(0, 0, resizeW, resizeH);
  const nchw = imageDataToNCHW(imgData, IMAGENET_MEAN, IMAGENET_STD);

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const tensor = new ort.Tensor('float32', nchw, [1, 3, resizeH, resizeW]);
  const outputs = await session.run({ [inputName]: tensor });
  const prob = outputs[outputName].data; // atteso [1,1,resizeH,resizeW]

  // soglia + dilatazione + connected components (4-connectivity) su bbox assiali.
  // La dilatazione unisce lettere vicine ma non toccantesi (tipico di loghi con
  // contorno bianco o ombreggiatura, es. "Gusti di Frontiera"), altrimenti il
  // flood-fill le trova come blob separati e le legge a pezzi (es. "G" / "usti").
  const THRESH = 0.3;
  const BOX_SCORE_THRESH = 0.5;
  const DILATE_RADIUS = 1; // ridotto da 2: un raggio fisso non può sistemare sia "G"+"usti" (font decorativo)
  // sia evitare di fondere parole distinte sulla stessa riga (es. "24-27 SETTEMBRE 2026") — è un
  // limite intrinseco della dilatazione a pixel fissi, non risolvibile del tutto senza polygon grouping
  // vero. La normalizzazione testuale a valle (vedi index.html) recupera gran parte dei casi di fusione.

  const binary = new Uint8Array(resizeW * resizeH);
  for (let i = 0; i < binary.length; i++) binary[i] = prob[i] >= THRESH ? 1 : 0;

  const dilated = new Uint8Array(resizeW * resizeH);
  for (let y = 0; y < resizeH; y++) {
    for (let x = 0; x < resizeW; x++) {
      let hit = 0;
      for (let dy = -DILATE_RADIUS; dy <= DILATE_RADIUS && !hit; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= resizeH) continue;
        const rowBase = ny * resizeW;
        for (let dx = -DILATE_RADIUS; dx <= DILATE_RADIUS; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= resizeW) continue;
          if (binary[rowBase + nx]) { hit = 1; break; }
        }
      }
      dilated[y * resizeW + x] = hit;
    }
  }

  const visited = new Uint8Array(resizeW * resizeH);
  const boxes = [];
  const stackX = new Int32Array(resizeW * resizeH);
  const stackY = new Int32Array(resizeW * resizeH);

  for (let y = 0; y < resizeH; y++) {
    for (let x = 0; x < resizeW; x++) {
      const idx = y * resizeW + x;
      if (visited[idx] || !dilated[idx]) continue;
      let sp = 0;
      stackX[sp] = x; stackY[sp] = y; sp++;
      visited[idx] = 1;
      let minX = x, maxX = x, minY = y, maxY = y, sum = 0, count = 0;
      while (sp > 0) {
        sp--;
        const cx = stackX[sp], cy = stackY[sp];
        const cidx = cy * resizeW + cx;
        // il punteggio si calcola solo sui pixel di testo "veri" (pre-dilatazione),
        // non su quelli aggiunti dalla dilatazione, per non gonfiare artificialmente lo score
        if (binary[cidx]) { sum += prob[cidx]; count++; }
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= resizeW || ny >= resizeH) continue;
          const nidx = ny * resizeW + nx;
          if (!visited[nidx] && dilated[nidx]) {
            visited[nidx] = 1;
            stackX[sp] = nx; stackY[sp] = ny; sp++;
          }
        }
      }
      if (count === 0) continue; // blob fatto solo di pixel aggiunti dalla dilatazione: scarta
      const score = sum / count;
      const w = maxX - minX + 1, h = maxY - minY + 1;
      if (count < 12 || score < BOX_SCORE_THRESH || w < 4 || h < 4) continue;
      // "unclip" approssimato: espande il box invece del poligono completo di PaddleOCR
      const padX = Math.round(h * 0.25) + 2;
      const padY = Math.round(h * 0.25) + 2;
      boxes.push({
        x: Math.max(0, (minX - padX) / ratioW),
        y: Math.max(0, (minY - padY) / ratioH),
        w: (w + padX * 2) / ratioW,
        h: (h + padY * 2) / ratioH,
        score,
      });
    }
  }

  // ordine di lettura: alto->basso, poi sinistra->destra
  boxes.sort((a, b) => (Math.abs(a.y - b.y) > a.h * 0.5 ? a.y - b.y : a.x - b.x));
  return boxes.map((b) => ({
    x: Math.min(b.x, bitmap.width - 1),
    y: Math.min(b.y, bitmap.height - 1),
    w: Math.min(b.w, bitmap.width - b.x),
    h: Math.min(b.h, bitmap.height - b.y),
  }));
}

// ---- recognition ----
async function recognizeCrop(bitmap, box, lang) {
  const ort = await getOrt();
  const { session, chars } = await getRecSession(lang);

  const targetH = 48;
  const targetW = Math.max(8, Math.round(targetH * (box.w / box.h)));
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, targetW, targetH);
  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const nchw = imageDataToNCHW(imgData, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const tensor = new ort.Tensor('float32', nchw, [1, 3, targetH, targetW]);
  const outputs = await session.run({ [inputName]: tensor });
  const out = outputs[outputName];
  const [, seqLen, numClasses] = out.dims; // atteso [1, T, numClasses]
  const logits = out.data;

  // CTC greedy decode: indice 0 = blank (convenzione PaddleOCR)
  let lastIdx = -1;
  let text = '';
  for (let t = 0; t < seqLen; t++) {
    let best = 0, bestVal = -Infinity;
    const base = t * numClasses;
    for (let c = 0; c < numClasses; c++) {
      const v = logits[base + c];
      if (v > bestVal) { bestVal = v; best = c; }
    }
    if (best !== 0 && best !== lastIdx) text += chars[best - 1] ?? '';
    lastIdx = best;
  }
  return text;
}

async function runRapidOCR({ imageDataUrl, lang }) {
  const t0 = performance.now();
  const bitmap = await bitmapFromDataUrl(imageDataUrl);
  const boxes = await detectBoxes(bitmap);
  const tDetected = performance.now();

  const lines = [];
  for (const box of boxes) {
    if (box.w < 2 || box.h < 2) continue;
    const text = await recognizeCrop(bitmap, box, lang);
    if (text.trim()) lines.push(text.trim());
  }
  const tDone = performance.now();

  return {
    text: lines.length ? lines.join('\n') : '(nessun blocco di testo rilevato — vedi limiti noti nei commenti)',
    loadMs: Math.round(tDetected - t0),
    inferMs: Math.round(tDone - tDetected),
    totalMs: Math.round(tDone - t0),
  };
}

// ---------- router ----------
self.onmessage = async (event) => {
  const { id, engine } = event.data;
  try {
    let result;
    if (engine === 'florence') result = await runFlorence(event.data);
    else if (engine === 'rapidocr') result = await runRapidOCR(event.data);
    else result = await runTrOCR(event.data);
    self.postMessage({ id, ok: true, ...result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  }
};
