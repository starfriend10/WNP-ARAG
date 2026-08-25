import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";
import {
  clearDocumentSession,
  forgetRagJob,
  getRagJobStatus,
  processDocument,
  resetClient,
  startDocumentProcessingJob,
  startDocumentRagJob,
  startRagJob,
  validateDocumentSession,
} from "./api.js";

const SPACE_ID = "starfriend/WNP-ARAG";
const API_RUN = "/run_rag_agent";
const API_STATUS = "/check_system_status";
const RETRY_INTERVAL_MS = 15000;
const MAX_WARMUP_MS = 10 * 60 * 1000;
const HF_RUNTIME_URL = `https://huggingface.co/api/spaces/${SPACE_ID}/runtime`;
const HF_SPACE_URL = `https://huggingface.co/api/spaces/${SPACE_ID}`;
const HF_APP_URL = "https://starfriend-wnp-arag.hf.space/";

const MAX_DOCUMENT_SIZE_MB = 25;
const MAX_DOCUMENT_SIZE_BYTES =
  MAX_DOCUMENT_SIZE_MB * 1024 * 1024;
const MAX_DOCUMENT_PAGES = 300;
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".pptx",
  ".html",
  ".htm",
  ".txt",
]);

const JURISDICTIONS = {
  fl: { label: "Florida", questionsUrl: "data/sample_questions/fl.json" },
  nj: { label: "New Jersey", questionsUrl: "data/sample_questions/nj.json" },
};
const DEFAULT_JURISDICTION = "fl";

const $ = (s) => document.querySelector(s);
const els = {
  knowledgeSource: $("#knowledge-source"),
  jurisdictionPanel: $("#jurisdiction-panel"),
  documentPanel: $("#document-panel"),
  samplesPanel: $("#samples-panel"),
  documentFile: $("#document-file"),
  processDocumentButton: $("#process-document-button"),
  documentStatus: $("#document-status"),
  vectorDownload: $("#vector-download"),
  emptyTitle: $("#empty-state-title"),
  jurisdiction: $("#jurisdiction"), jurisdictionNote: $("#jurisdiction-note"),
  emptyMessage: $("#empty-state-message"), question: $("#question"), topK: $("#top-k"), maxLoops: $("#max-loops"),
  ask: $("#ask-button"), clear: $("#clear-button"), status: $("#system-status"),
  statusText: $("#system-status-text"), statusBackend: $("#status-backend"),
  statusStateVector: $("#status-state-vector"), statusUserVector: $("#status-user-vector"),
  statusGpu: $("#status-gpu"), statusLlm: $("#status-llm"),
  runtimeStateVector: $("#runtime-state-vector"),
  runtimeUserVector: $("#runtime-user-vector"), runtimeGpu: $("#runtime-gpu"),
  runtimeLlm: $("#runtime-llm"),
  warmup: $("#warmup-panel"), warmupTitle: $("#warmup-title"),
  warmupMessage: $("#warmup-message"), warmupElapsed: $("#warmup-elapsed"),
  warmupRetry: $("#warmup-retry"), sampleSearch: $("#sample-search"),
  sampleList: $("#sample-list"), sampleCount: $("#sample-count"),
  empty: $("#empty-state"), loading: $("#loading-state"), error: $("#error-state"),
  results: $("#results-state"), loadingTitle: $("#loading-title"),
  loadingMessage: $("#loading-message"), progress: $("#progress-bar"),
  errorMessage: $("#error-message"), answer: $("#answer-output"),
  sources: $("#sources-output"), sourceCount: $("#source-count"),
  journey: $("#journey-output"), journeyDetails: $("#journey-details"),
  diagnostics: $("#diagnostics-output"),
  requestElapsed: $("#request-elapsed"),
  documentElapsed: $("#document-elapsed"),
  liveJourneyPanel: $("#live-journey-panel"),
  liveJourney: $("#live-journey-output"),
  liveJourneyState: $("#live-journey-state")
};

let client = null, backendReady = false, modelReady = false, running = false;
let warmupStarted = Date.now(), warmupCompletedAt = null, retryTimer = null, elapsedTimer = null;
let loadingTimer = null, requestTimer = null, requestStartedAt = null;
let documentTimer = null, documentStartedAt = null, sampleQuestions = [];
let currentJurisdiction = DEFAULT_JURISDICTION;
let currentMode = "jurisdiction";
let documentSessionId = "";
let documentReady = false;

const EXPLORER_STATE_KEY =
  "wnp_arag_explorer_state_v2";
const JOB_POLL_INTERVAL_MS = 1200;

let currentJobId = "";
let latestJobSnapshot = null;
let jobPollTimer = null;
let currentDocumentJobId = "";
let latestDocumentJobSnapshot = null;
let documentJobPollTimer = null;
let restoringExplorerState = false;

// Retry counts are an internal detail; only elapsed time is shown to users.
if (els.warmupRetry) {
  const retryRow = els.warmupRetry.closest("span");
  if (retryRow) retryRow.hidden = true;
}

const stages = [
  ["Connecting to the backend…", "Establishing a connection to the Hugging Face Space.", 18],
  ["Searching regulations…", "Retrieving passages from the regulatory knowledge base.", 44],
  ["Evaluating evidence…", "Assessing whether the retrieved passages are sufficient.", 68],
  ["Generating response…", "Preparing a grounded answer and organizing the supporting sources.", 88]
];

function escapeHtml(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function normalizeMarkdownText(value) {
  return String(value ?? "")
    /*
      PowerPoint-derived text often contains KPI labels such as:
      "- # of companies adopting..."
      Markdown interprets "# ..." as a heading inside the list item, producing
      unexpectedly large text. Escape only these number-sign phrases while
      preserving legitimate Markdown headings elsewhere.
    */
    .replace(
      /^(\s*[-*+]\s+)#\s+(?=(?:of|number|percentage|percent|share|total)\b)/gim,
      "$1\\\\# ",
    )
    .replace(
      /^(\s*)#\s+(?=(?:of|number|percentage|percent|share|total)\b)/gim,
      "$1\\\\# ",
    );
}

function markdown(v) {
  const t = normalizeMarkdownText(v).trim();

  return t
    ? (
        window.marked
          ? window.marked.parse(
              t,
              {
                gfm: true,
                breaks: true,
              },
            )
          : `<p>${escapeHtml(t)}</p>`
      )
    : "";
}
function showState(name) {
  ({empty:els.empty, loading:els.loading, error:els.error, results:els.results});
  els.empty.hidden = name !== "empty"; els.loading.hidden = name !== "loading";
  els.error.hidden = name !== "error"; els.results.hidden = name !== "results";
}
function setStatus(kind, text) {
  els.status.className = `status-badge status-badge--${kind}`;
  els.statusText.textContent = text;
}
function setRuntimeIndicator(element, state, label) {
  if (!element) return;
  element.className = `runtime-indicator runtime-indicator--${state}`;
  element.textContent = label;
}
function updateRuntimeIndicators({backend="pending",stateVector="pending",userVector="empty",gpu="pending",llm="pending"}={}) {
  setRuntimeIndicator(els.runtimeBackend,backend,backend === "ready" ? "Server ready" : "Server");
  setRuntimeIndicator(els.runtimeStateVector,stateVector,stateVector === "ready" ? "State vector DB loaded" : stateVector === "loading" ? "State vector DB loading" : stateVector === "standby" ? "State vector DB on demand" : "State vector DB");
  setRuntimeIndicator(els.runtimeUserVector,userVector,userVector === "ready" ? "User vector DB ready" : userVector === "processing" ? "User vector DB processing" : userVector === "error" ? "User vector DB failed" : "No user vector DB");
  setRuntimeIndicator(els.runtimeGpu,gpu,gpu === "ready" ? "GPU ready" : "GPU");
  setRuntimeIndicator(els.runtimeLlm,llm,llm === "ready" ? "LLM ready" : llm === "loading" ? "LLM loading" : llm === "standby" ? "LLM on demand" : "LLM");
}
function refreshDocumentTimer() {
  if (documentStartedAt === null || !els.documentElapsed) return;
  els.documentElapsed.textContent = elapsed(Date.now() - documentStartedAt);
}
function startDocumentTimer() {
  clearInterval(documentTimer);
  documentStartedAt = Date.now();
  refreshDocumentTimer();
  documentTimer = window.setInterval(refreshDocumentTimer,250);
}
function stopDocumentTimer() {
  refreshDocumentTimer();
  clearInterval(documentTimer);
  documentTimer = null;
}
function disableControls(disabled) {
  [
    els.knowledgeSource,
    els.jurisdiction,
    els.question,
    els.topK,
    els.maxLoops,
    els.clear,
    els.sampleSearch,
    els.documentFile,
    els.processDocumentButton,
  ].forEach((element) => {
    if (element) element.disabled = disabled;
  });
  els.sampleList.querySelectorAll("button").forEach(x => x.disabled = disabled);
}
function elapsed(ms) {
  const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
}



let lastWakeRequestAt = 0;
const WAKE_REQUEST_INTERVAL_MS = 12000;

async function wakeSpace(force = false) {
  /*
    Hugging Face runtime-metadata requests do not wake a sleeping Space.
    A request to the public hf.space application does.

    no-cors is intentional because the response body is not needed; the goal
    is simply to send a request that triggers normal Space startup.
  */
  const now = Date.now();

  if (
    !force &&
    now - lastWakeRequestAt < WAKE_REQUEST_INTERVAL_MS
  ) {
    return;
  }

  lastWakeRequestAt = now;

  try {
    await fetch(
      `${HF_APP_URL}?wake=${now}`,
      {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
      },
    );
  } catch (error) {
    console.info(
      "The Space wake-up request was sent but its response could not be inspected:",
      error,
    );
  }
}

async function fetchSpaceRuntime() {
  const request = async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Hugging Face runtime request returned ${response.status}`);
    }
    return response.json();
  };

  try {
    return await request(HF_RUNTIME_URL);
  } catch (runtimeError) {
    // Fallback: the general Space metadata endpoint may include runtime data.
    const spaceInfo = await request(HF_SPACE_URL);
    return spaceInfo.runtime || spaceInfo;
  }
}

function runtimeStage(runtime) {
  return String(runtime?.stage || runtime?.runtime?.stage || "UNKNOWN").toUpperCase();
}

function runtimeText(runtime) {
  try {
    return JSON.stringify(runtime).toLowerCase();
  } catch {
    return "";
  }
}

function setWarmupMessage(title, message) {
  els.warmupTitle.textContent = title;
  els.warmupMessage.textContent = message;
}

function stopWarmupElapsedTimer() {
  clearInterval(elapsedTimer);
  elapsedTimer = null;

  if (els.warmupElapsed) {
    const endpoint =
      warmupCompletedAt || Date.now();
    els.warmupElapsed.textContent =
      elapsed(endpoint - warmupStarted);
  }
}

function setTerminalBackendState(title, message, statusLabel = "Backend unavailable") {
  backendReady = false;
  client = null;
  clearTimeout(retryTimer);
  retryTimer = null;
  stopWarmupElapsedTimer();
  setStatus("error", statusLabel);
  els.ask.disabled = true;
  els.ask.textContent = statusLabel;

  els.warmupTitle.textContent = title;
  els.warmupMessage.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <a class="server-help-link" href="documentation.html#server-connection">
      Learn about server hardware availability
    </a>
  `;
}

function describeRuntime(runtime) {
  const stage = runtimeStage(runtime);
  const raw = runtimeText(runtime);

  if (/scheduling failure|unable to schedule|not enough hardware|hardware capacity/.test(raw)) {
    return {
      type: "scheduling",
      title: "Waiting for Hugging Face hardware",
      message: "The requested GPU could not be scheduled. Please come back and try again later.",
      retry: true,
    };
  }

  if (stage === "RUNNING") {
    return {
      type: "running",
      title: "Connecting to the WNP-ARAG server…",
      message: "The Space is running. Establishing the application connection.",
      retry: false,
    };
  }

  if (["BUILDING", "BUILDING_FROM_CACHE"].includes(stage)) {
    return {
      type: "building",
      title: "Building the backend",
      message: "The Hugging Face Space is building the backend. This may take several minutes.",
      retry: true,
    };
  }

  if (["APP_STARTING", "STARTING", "SLEEPING", "STOPPED"].includes(stage)) {
    return {
      type: "starting",
      title: "Connecting to the WNP-ARAG server…",
      message: "The Space is starting. This page will continue waiting automatically.",
      retry: true,
    };
  }

  if (stage === "PAUSED") {
    return {
      type: "paused",
      title: "Backend paused",
      message: "The developers may be testing or troubleshooting the backend. The Space must be restarted by its owner.",
      retry: false,
    };
  }

  if (["BUILD_ERROR", "CONFIG_ERROR", "NO_APP_FILE"].includes(stage)) {
    return {
      type: "build_error",
      title: "Backend build error",
      message: "The backend failed to start due to a build error. Please contact the platform owner.",
      retry: false,
    };
  }

  if (stage === "RUNTIME_ERROR") {
    return {
      type: "runtime_error",
      title: "Backend runtime error",
      message: "The backend encountered a runtime error. Please contact the platform owner.",
      retry: false,
    };
  }

  return {
    type: "unknown",
    title: "Checking backend status…",
    message: "Unable to determine the backend status. This page will continue checking.",
    retry: true,
  };
}

function scheduleBackendRetry() {
  const elapsedMs = Date.now() - warmupStarted;
  if (elapsedMs >= MAX_WARMUP_MS) {
    setTerminalBackendState(
      "Backend startup delayed",
      "The backend is taking longer than expected to start, likely due to Hugging Face infrastructure or GPU scheduling. Please come back and try again later."
    );
    return;
  }

  clearTimeout(retryTimer);
  retryTimer = setTimeout(connectBackend, RETRY_INTERVAL_MS);
}

async function connectBackend() {
  if (running) return;

  // Visiting the Explorer should actively wake a sleeping Hugging Face Space.
  // Runtime API checks alone do not trigger startup.
  await wakeSpace();

  setStatus("starting", "Checking Space runtime…");
  updateRuntimeIndicators({
    backend: "pending",
    stateVector: "pending",
    userVector: documentReady ? "ready" : "empty",
    gpu: "pending",
    llm: "pending",
  });

  setWarmupMessage(
    "Checking the WNP-ARAG server…",
    "The Space may be restarting, rebuilding, or waiting for hardware."
  );

  try {
    const runtime = await fetchSpaceRuntime();
    const state = describeRuntime(runtime);

    if (
      state.type === "building" ||
      state.type === "scheduling" ||
      state.type === "starting"
    ) {
      backendReady = false;
      client = null;

      if (state.type === "scheduling") {
        setTerminalBackendState(
          "Waiting for Hugging Face hardware",
          "The requested GPU could not be scheduled because there is currently not enough hardware capacity. Please come back and try again later.",
          "Waiting for hardware",
        );
        return;
      }

      if (state.type === "starting") {
        await wakeSpace();
      }

      setWarmupMessage(
        state.title,
        state.message,
      );

      setStatus(
        "starting",
        state.type === "building"
          ? "Building backend…"
          : "Restarting backend…",
      );

      updateRuntimeIndicators({
        backend: "pending",
        stateVector: "pending",
        userVector: documentReady ? "ready" : "empty",
        gpu: "pending",
        llm: "pending",
      });

      scheduleBackendRetry();
      return;
    }

    if (state.type === "paused") {
      setTerminalBackendState(
        state.title,
        state.message,
        "Backend paused",
      );
      return;
    }

    if (state.type === "build_error") {
      setTerminalBackendState(
        state.title,
        state.message,
        "Build error",
      );
      return;
    }

    if (state.type === "runtime_error") {
      const runtimeMessage = String(
        state.message || "",
      );
      const hardwareUnavailable =
        /scheduling failure|not enough hardware capacity/i.test(
          runtimeMessage,
        );

      setTerminalBackendState(
        hardwareUnavailable
          ? "Waiting for Hugging Face hardware"
          : state.title,
        hardwareUnavailable
          ? "The requested GPU could not be scheduled because there is currently not enough hardware capacity. Please come back and try again later."
          : state.message,
        hardwareUnavailable
          ? "Waiting for hardware"
          : "Runtime error",
      );
      return;
    }
  } catch (runtimeError) {
    console.info(
      "Runtime metadata could not be confirmed yet:",
      runtimeError,
    );

    await wakeSpace();
  }

  setStatus("starting", "Connecting to server…");

  try {
    client = await Client.connect(SPACE_ID);

    let statusText = "";
    try {
      const result = await client.predict(
        API_STATUS,
        [],
      );
      statusText = String(
        result?.data?.[0] ?? "",
      );
    } catch (statusError) {
      throw new Error(
        "The application status endpoint is not ready."
      );
    }

    backendReady = true;
    if (!warmupCompletedAt) {
      warmupCompletedAt = Date.now();
    }
    stopWarmupElapsedTimer();
    saveExplorerState();

    els.statusBackend.textContent =
      "✓ Server connected";

    const lower = statusText.toLowerCase();

    modelReady =
      lower.includes("model loaded: yes") ||
      lower.includes("language model loaded: yes") ||
      lower.includes("model ready: yes");

    const stateVectorLoaded =
      lower.includes("vector database loaded in memory: yes") ||
      lower.includes("loaded vector databases: florida") ||
      lower.includes("loaded vector databases: new jersey");

    const gpuReady =
      lower.includes("cuda available: yes") ||
      lower.includes("gpu available: yes");

    els.statusStateVector.textContent =
      stateVectorLoaded
        ? "✓ State vector database loaded"
        : "○ State vector database will load when requested";

    els.statusUserVector.textContent =
      documentReady
        ? "✓ User vector database ready"
        : "○ No user vector database";

    els.statusGpu.textContent =
      gpuReady
        ? "✓ GPU available"
        : "○ GPU status unavailable";

    els.statusLlm.textContent =
      modelReady
        ? "✓ LLM loaded"
        : "○ LLM will load on the first question";

    updateRuntimeIndicators({
      backend: "ready",
      stateVector: stateVectorLoaded
        ? "ready"
        : "standby",
      userVector: documentReady
        ? "ready"
        : "empty",
      gpu: gpuReady
        ? "ready"
        : "pending",
      llm: modelReady
        ? "ready"
        : "standby",
    });

    setStatus(
      "ready",
      "System ready",
    );

    els.warmup.hidden = true;
    els.ask.disabled = false;
    els.ask.textContent = "Ask";

    clearTimeout(retryTimer);
    retryTimer = null;
  } catch (connectError) {
    backendReady = false;
    client = null;

    setWarmupMessage(
      "Connecting to the WNP-ARAG server…",
      "The Space is still restarting or the Gradio application is not ready. This page will continue checking automatically.",
    );

    setStatus(
      "starting",
      "Restarting backend…",
    );

    updateRuntimeIndicators({
      backend: "pending",
      stateVector: "pending",
      userVector: documentReady ? "ready" : "empty",
      gpu: "pending",
      llm: "pending",
    });

    scheduleBackendRetry();

    console.info(
      "Backend is not ready yet:",
      connectError,
    );
  }
}
async function loadSamples(jurisdiction = currentJurisdiction) {
  const config = JURISDICTIONS[jurisdiction];
  if (!config) {
    els.sampleCount.textContent = "Unavailable";
    els.sampleList.innerHTML = "<p>Unsupported jurisdiction.</p>";
    return;
  }

  els.sampleCount.textContent = "Loading…";
  els.sampleList.innerHTML = "<p>Loading sample questions…</p>";

  try {
    const response = await fetch(config.questionsUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));

    const payload = await response.json();
    sampleQuestions = Array.isArray(payload) ? payload : (payload.questions || []);
    sampleQuestions = sampleQuestions.filter(
      item => item && typeof item.question === "string" && item.question.trim()
    );
    renderSamples(sampleQuestions);
  } catch (error) {
    sampleQuestions = [];
    els.sampleCount.textContent = "Unavailable";
    els.sampleList.innerHTML = `<p>${escapeHtml(config.label)} sample questions could not be loaded.</p>`;
    console.error(error);
  }
}

function explorerStatePayload() {
  return {
    version: 3,
    mode: currentMode,
    jurisdiction: currentJurisdiction,
    question: els.question.value,
    topK: els.topK.value,
    maxLoops: els.maxLoops.value,
    currentJobId,
    latestJobSnapshot,
    currentDocumentJobId,
    latestDocumentJobSnapshot,
    requestStartedAt,
    documentStartedAt,
    requestElapsed: els.requestElapsed.textContent,
    warmupStarted,
    warmupCompletedAt,
    warmupElapsed: els.warmupElapsed?.textContent || "0:00",
    documentSessionId,
    documentReady,
    documentFileName:
      els.documentFile.files?.[0]?.name
      || latestJobSnapshot?.documentFileName
      || "",
    documentStatusHtml:
      els.documentStatus.innerHTML,
    documentStatusClass:
      els.documentStatus.className,
    documentDownloadUrl:
      els.vectorDownload.hidden
        ? ""
        : els.vectorDownload.href,
    scrollY: window.scrollY,
    savedAt: Date.now(),
  };
}

function saveExplorerState() {
  try {
    sessionStorage.setItem(
      EXPLORER_STATE_KEY,
      JSON.stringify(explorerStatePayload()),
    );
  } catch (error) {
    console.warn(
      "Explorer state could not be saved:",
      error,
    );
  }
}

function loadExplorerState() {
  try {
    const raw = sessionStorage.getItem(
      EXPLORER_STATE_KEY,
    );

    if (!raw) {
      return null;
    }

    const state = JSON.parse(raw);

    return [2, 3].includes(state?.version)
      ? state
      : null;
  } catch (error) {
    console.warn(
      "Explorer state could not be restored:",
      error,
    );
    return null;
  }
}

function clearSavedExplorerState() {
  sessionStorage.removeItem(
    EXPLORER_STATE_KEY,
  );
}


function applyDocumentJobSnapshot(snapshot) {
  if (!snapshot) return;

  latestDocumentJobSnapshot = snapshot;

  const status = String(
    snapshot.document_status || "",
  ).trim();

  if (status) {
    els.documentStatus.className =
      snapshot.state === "failed"
        ? "document-status error"
        : snapshot.document_ready
          ? "document-status ready"
          : "document-status processing";
    els.documentStatus.innerHTML = markdown(status);
  }

  const downloadUrl = normalizeDownloadUrl(
    snapshot.document_download,
  );
  if (downloadUrl) {
    els.vectorDownload.href = downloadUrl;
    els.vectorDownload.hidden = false;
  }

  if (snapshot.document_session_id) {
    documentSessionId = String(
      snapshot.document_session_id,
    );
  }

  documentReady =
    snapshot.document_ready === true;
}

async function pollDocumentProcessingJob(
  jobId,
  { forceReconnect = false } = {},
) {
  clearTimeout(documentJobPollTimer);
  documentJobPollTimer = null;
  currentDocumentJobId = String(jobId || "").trim();

  if (!currentDocumentJobId) {
    throw new Error(
      "No resumable document-processing job ID was returned.",
    );
  }

  running = true;
  disableControls(true);
  els.processDocumentButton.textContent =
    "Processing document…";
  updateAskButton();
  saveExplorerState();

  let reconnect = forceReconnect;

  while (currentDocumentJobId) {
    let snapshot;
    try {
      snapshot = await getRagJobStatus(
        currentDocumentJobId,
        { forceReconnect: reconnect },
      );
      reconnect = false;
    } catch (error) {
      console.warn(
        "Document job status check failed:",
        error,
      );
      await wait(3000);
      reconnect = true;
      continue;
    }

    if (!snapshot?.found) {
      currentDocumentJobId = "";
      running = false;
      disableControls(false);
      updateAskButton();
      stopDocumentTimer();
      els.documentStatus.className =
        "document-status error";
      els.documentStatus.innerHTML = markdown(
        snapshot?.error
        || "The resumable document-processing job is no longer available.",
      );
      saveExplorerState();
      return;
    }

    applyDocumentJobSnapshot(snapshot);
    saveExplorerState();

    if (snapshot.state === "completed") {
      currentDocumentJobId = "";
      stopDocumentTimer();
      running = false;
      disableControls(false);
      documentReady = snapshot.document_ready === true;
      modelReady = false;

      els.statusUserVector.textContent = documentReady
        ? "✓ User vector database ready"
        : "○ No user vector database";
      els.statusGpu.textContent =
        "○ GPU will be rechecked before the question";
      els.statusLlm.textContent =
        "○ LLM will be rechecked before the question";
      updateRuntimeIndicators({
        stateVector: "standby",
        userVector: documentReady ? "ready" : "empty",
        gpu: "pending",
        llm: "pending",
      });
      els.processDocumentButton.textContent =
        "Process document";
      els.emptyTitle.textContent =
        "Ask a question about your document";
      els.emptyMessage.textContent =
        "Enter a question about the processed document to begin.";
      updateAskButton();
      saveExplorerState();
      return;
    }

    if (snapshot.state === "failed") {
      currentDocumentJobId = "";
      stopDocumentTimer();
      running = false;
      disableControls(false);
      documentReady = false;
      els.statusUserVector.textContent =
        "✗ User vector database creation failed";
      updateRuntimeIndicators({
        stateVector: "standby",
        userVector: "error",
        gpu: "pending",
        llm: "pending",
      });
      els.processDocumentButton.textContent =
        "Process document";
      els.documentStatus.className =
        "document-status error";
      els.documentStatus.innerHTML = markdown(
        snapshot.error
        || snapshot.document_status
        || "The document could not be processed.",
      );
      updateAskButton();
      saveExplorerState();
      return;
    }

    await wait(JOB_POLL_INTERVAL_MS);
  }
}

function applyJobSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  latestJobSnapshot = snapshot;

  if (snapshot.process) {
    updateLiveJourney(snapshot.process);
    synchronizeRequestStage(
      snapshot.process,
      snapshot.answer,
    );
  }

  if (snapshot.state === "queued") {
    els.loadingTitle.textContent =
      "Request queued…";
    els.loadingMessage.textContent =
      "Waiting for the backend worker to begin.";
    els.progress.style.width = "12%";
    setLiveJourneyState("Queued", "running");
  }

  if (snapshot.state === "running") {
    setLiveJourneyState(
      snapshot.answer
        ? "Finalizing"
        : "Searching",
      "running",
    );
  }
}

function renderCompletedJob(snapshot) {
  latestJobSnapshot = snapshot;

  els.answer.innerHTML = markdown(
    snapshot.answer || "",
  );
  renderSources(snapshot.sources || "");
  renderJourney(snapshot.process || "");
  els.diagnostics.textContent =
    String(snapshot.diagnostics || "").trim();

  els.journeyDetails.open = false;
  els.liveJourneyPanel.hidden = true;
  showState("results");

  modelReady = true;
  setStatus("ready", "System ready");
  els.statusBackend.textContent =
    "✓ Server connected";
  els.statusGpu.textContent =
    "✓ GPU available";
  els.statusLlm.textContent =
    "✓ LLM loaded";

  if (currentMode === "jurisdiction") {
    els.statusStateVector.textContent =
      `✓ ${selectedJurisdictionConfig().label} state vector database loaded`;
  }

  els.statusUserVector.textContent =
    documentReady
      ? "✓ User vector database available"
      : "○ No user vector database";

  updateRuntimeIndicators({
    stateVector:
      currentMode === "jurisdiction"
        ? "ready"
        : "standby",
    userVector:
      documentReady
        ? "ready"
        : "empty",
    gpu: "ready",
    llm: "ready",
  });

  if (snapshot.completed_at) {
    requestStartedAt =
      Number(snapshot.started_at)
      ? Number(snapshot.started_at) * 1000
      : requestStartedAt;

    els.requestElapsed.textContent =
      elapsed(
        (
          Number(snapshot.completed_at)
          - Number(
            snapshot.started_at
            || snapshot.created_at
          )
        ) * 1000,
      );
  }

  saveExplorerState();
}

function showResumableJobError(message) {
  stopStages();
  stopRequestTimer();
  els.liveJourneyPanel.hidden = true;
  showState("error");
  els.errorMessage.textContent =
    message || "The resumable request failed.";
  setStatus("error", "Request failed");
  saveExplorerState();
}

async function pollRagJob(
  jobId,
  {
    forceReconnect = false,
  } = {},
) {
  clearTimeout(jobPollTimer);
  jobPollTimer = null;

  currentJobId = String(jobId || "").trim();

  if (!currentJobId) {
    throw new Error(
      "No resumable job ID was returned.",
    );
  }

  running = true;
  disableControls(true);
  updateAskButton();
  showState("loading");
  els.liveJourneyPanel.hidden = false;
  saveExplorerState();

  let reconnect = forceReconnect;

  while (currentJobId) {
    let snapshot;

    try {
      snapshot = await getRagJobStatus(
        currentJobId,
        {
          forceReconnect: reconnect,
        },
      );
      reconnect = false;
    } catch (error) {
      console.warn(
        "Resumable job status check failed:",
        error,
      );

      await wait(3000);
      reconnect = true;
      continue;
    }

    if (!snapshot?.found) {
      currentJobId = "";
      running = false;
      disableControls(false);
      updateAskButton();

      showResumableJobError(
        snapshot?.error
        || (
          "The resumable request is no longer available. "
          + "The Space may have restarted."
        ),
      );
      return;
    }

    applyJobSnapshot(snapshot);
    saveExplorerState();

    if (snapshot.state === "completed") {
      stopStages();
      stopRequestTimer();
      running = false;
      disableControls(false);
      updateAskButton();
      renderCompletedJob(snapshot);
      return;
    }

    if (
      snapshot.state === "failed"
      || snapshot.state === "cancelled"
    ) {
      currentJobId = "";
      running = false;
      disableControls(false);
      updateAskButton();

      showResumableJobError(
        snapshot.error
        || "The resumable request failed.",
      );
      return;
    }

    await wait(JOB_POLL_INTERVAL_MS);
  }
}

async function restoreExplorerState() {
  const state = loadExplorerState();

  if (!state) {
    return;
  }

  restoringExplorerState = true;

  currentMode =
    state.mode === "document"
      ? "document"
      : "jurisdiction";
  currentJurisdiction =
    JURISDICTIONS[state.jurisdiction]
      ? state.jurisdiction
      : DEFAULT_JURISDICTION;

  els.knowledgeSource.value = currentMode;
  els.jurisdiction.value = currentJurisdiction;

  await changeKnowledgeSource();
  await changeJurisdiction();

  els.question.value =
    String(state.question || "");
  els.topK.value =
    String(state.topK || els.topK.value);
  els.maxLoops.value =
    String(state.maxLoops || els.maxLoops.value);

  documentSessionId =
    String(state.documentSessionId || "");
  documentReady =
    state.documentReady === true;

  if (state.documentStatusHtml) {
    els.documentStatus.innerHTML =
      state.documentStatusHtml;
    els.documentStatus.className =
      state.documentStatusClass
      || "document-status";
  }

  if (state.documentDownloadUrl) {
    els.vectorDownload.href =
      state.documentDownloadUrl;
    els.vectorDownload.hidden = false;
  }

  currentJobId =
    String(state.currentJobId || "");
  latestJobSnapshot =
    state.latestJobSnapshot || null;
  requestStartedAt =
    Number(state.requestStartedAt) || null;
  warmupStarted =
    Number(state.warmupStarted) || warmupStarted;
  warmupCompletedAt =
    Number(state.warmupCompletedAt) || null;

  if (els.warmupElapsed) {
    const endpoint =
      warmupCompletedAt || Date.now();
    els.warmupElapsed.textContent =
      elapsed(endpoint - warmupStarted);
  }

  documentStartedAt =
    Number(state.documentStartedAt) || null;
  currentDocumentJobId =
    String(state.currentDocumentJobId || "");
  latestDocumentJobSnapshot =
    state.latestDocumentJobSnapshot || null;

  if (latestDocumentJobSnapshot) {
    applyDocumentJobSnapshot(
      latestDocumentJobSnapshot,
    );
  }

  if (
    currentDocumentJobId
    || ["queued", "running"].includes(
      latestDocumentJobSnapshot?.state,
    )
  ) {
    running = true;
    if (documentStartedAt) {
      clearInterval(documentTimer);
      documentTimer = setInterval(
        refreshDocumentTimer,
        250,
      );
      refreshDocumentTimer();
    }
    window.setTimeout(() => {
      pollDocumentProcessingJob(
        currentDocumentJobId
        || latestDocumentJobSnapshot?.job_id,
        { forceReconnect: true },
      );
    }, 500);
  }

  if (latestJobSnapshot?.state === "completed") {
    renderCompletedJob(
      latestJobSnapshot,
    );
  } else if (
    currentJobId
    || ["queued", "running"].includes(
      latestJobSnapshot?.state,
    )
  ) {
    running = true;
    showState("loading");
    els.liveJourneyPanel.hidden = false;

    if (latestJobSnapshot) {
      applyJobSnapshot(
        latestJobSnapshot,
      );
    }

    if (requestStartedAt) {
      clearInterval(requestTimer);
      requestTimer = setInterval(() => {
        els.requestElapsed.textContent =
          elapsed(
            Date.now()
            - requestStartedAt,
          );
      }, 1000);
    }

    window.setTimeout(() => {
      pollRagJob(
        currentJobId
        || latestJobSnapshot?.job_id,
        {
          forceReconnect: true,
        },
      );
    }, 500);
  }

  if (
    currentMode === "document"
    && documentReady
    && documentSessionId
  ) {
    window.setTimeout(async () => {
      try {
        const validation =
          await validateDocumentSession(
            documentSessionId,
            {
              forceReconnect: true,
            },
          );

        if (!validation.valid) {
          markDocumentSessionLost(
            validation.message,
          );
          saveExplorerState();
        }
      } catch (error) {
        console.warn(
          "Restored document session could not be validated:",
          error,
        );
      }
    }, 1000);
  }

  restoringExplorerState = false;

  window.setTimeout(() => {
    window.scrollTo(
      0,
      Number(state.scrollY) || 0,
    );
  }, 0);
}

function renderSamples(items) {
  els.sampleCount.textContent = `${items.length} questions`;
  els.sampleList.innerHTML = "";
  if (!items.length) { els.sampleList.innerHTML = "<p>No matching questions.</p>"; return; }
  items.forEach(item => {
    const q = typeof item === "string" ? item : String(item.question || "");
    const b = document.createElement("button"); b.type="button"; b.className="sample-question"; b.textContent=q;
    b.onclick = () => { els.question.value=q; els.question.focus(); window.scrollTo({top:0,behavior:"smooth"}); };
    els.sampleList.appendChild(b);
  });
}
function filterSamples() {
  const q = els.sampleSearch.value.trim().toLowerCase();
  renderSamples(!q ? sampleQuestions : sampleQuestions.filter(x => (typeof x === "string" ? x : x.question || "").toLowerCase().includes(q)));
}

function selectedJurisdictionConfig() {
  return JURISDICTIONS[currentJurisdiction] || JURISDICTIONS[DEFAULT_JURISDICTION];
}

async function changeJurisdiction() {
  if (running && !restoringExplorerState) return;

  currentJurisdiction = els.jurisdiction.value;
  const config = selectedJurisdictionConfig();

  els.jurisdictionNote.textContent =
    `Using the ${config.label} regulatory database and question library`;
  els.emptyMessage.textContent =
    `Select a ${config.label} sample question or enter your own question to begin.`;

  if (!restoringExplorerState) {
    els.question.value = "";
    els.sampleSearch.value = "";
  }
  els.answer.innerHTML = "";
  els.sources.innerHTML = "";
  els.journey.innerHTML = "";
  els.diagnostics.textContent = "";
  els.sourceCount.textContent = "0 sources";
  els.journeyDetails.open = false;
  showState("empty");

  await loadSamples(currentJurisdiction);
}


function normalizeDownloadUrl(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.url || value.path || value.name || "";
}

function clearResultsOnly() {
  els.answer.innerHTML = "";
  els.sources.innerHTML = "";
  els.journey.innerHTML = "";
  els.diagnostics.textContent = "";
  els.sourceCount.textContent = "0 sources";
  els.journeyDetails.open = false;
  showState("empty");
}

async function changeKnowledgeSource() {
  if (running && !restoringExplorerState) return;

  currentMode = els.knowledgeSource.value;
  const documentMode = currentMode === "document";

  els.jurisdictionPanel.hidden = documentMode;
  els.documentPanel.hidden = !documentMode;
  els.samplesPanel.hidden = documentMode;

  if (!restoringExplorerState) {
    els.question.value = "";
    els.sampleSearch.value = "";
    clearResultsOnly();
  }
  stopRequestTimer();
  requestStartedAt = null;
  els.requestElapsed.textContent = "0:00";
  stopDocumentTimer();
  documentStartedAt = null;
  els.documentElapsed.textContent = "0:00";
  resetLiveJourney();

  if (documentMode) {
    els.emptyTitle.textContent = "Ask a question about your document";
    els.emptyMessage.textContent = documentReady
      ? "Enter a question about the processed document to begin."
      : "Choose and process a document before asking a question.";
  } else {
    const config = selectedJurisdictionConfig();
    els.emptyTitle.textContent = "Ask a regulatory question";
    els.emptyMessage.textContent =
      `Select a ${config.label} sample question or enter your own question to begin.`;
  }

  updateAskButton();
}


function documentExtension(fileName) {
  const normalized =
    String(fileName || "").toLowerCase();

  const dotIndex =
    normalized.lastIndexOf(".");

  return dotIndex >= 0
    ? normalized.slice(dotIndex)
    : "";
}

function formatFileSize(bytes) {
  return `${(
    Number(bytes || 0) /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

function validateSelectedDocument({
  showMessage = true,
} = {}) {
  const file =
    els.documentFile.files?.[0];

  if (!file) {
    els.processDocumentButton.disabled = true;

    if (showMessage) {
      els.documentStatus.className =
        "document-status";

      els.documentStatus.textContent =
        "No document has been selected.";
    }

    return {
      valid: false,
      reason: "missing",
    };
  }

  const extension =
    documentExtension(file.name);

  if (
    !SUPPORTED_DOCUMENT_EXTENSIONS.has(
      extension,
    )
  ) {
    els.processDocumentButton.disabled = true;

    if (showMessage) {
      els.documentStatus.className =
        "document-status error";

      els.documentStatus.innerHTML = markdown(
        [
          "### Unsupported file type",
          "",
          `**Selected document:** ${file.name}`,
          "",
          (
            "Supported formats are PDF, DOC, DOCX, PPTX, "
            + "HTML, HTM, and TXT."
          ),
        ].join("\n"),
      );
    }

    return {
      valid: false,
      reason: "type",
    };
  }

  if (
    file.size >
    MAX_DOCUMENT_SIZE_BYTES
  ) {
    els.processDocumentButton.disabled = true;
    documentReady = false;
    documentSessionId = "";

    els.statusUserVector.textContent =
      "✗ Selected file exceeds limit";

    updateRuntimeIndicators({
      stateVector: "standby",
      userVector: "error",
      gpu: "pending",
      llm: "pending",
    });

    if (showMessage) {
      els.documentStatus.className =
        "document-status error";

      els.documentStatus.innerHTML = markdown(
        [
          "### File exceeds the upload limit",
          "",
          `**Selected document:** ${file.name}`,
          `**File size:** ${formatFileSize(file.size)}`,
          `**Maximum supported size:** ${MAX_DOCUMENT_SIZE_MB} MB`,
          "",
          (
            "Choose a smaller document or divide it into "
            + "multiple files before processing."
          ),
        ].join("\n"),
      );
    }

    els.vectorDownload.hidden = true;

    return {
      valid: false,
      reason: "size",
    };
  }

  els.processDocumentButton.disabled =
    running || !backendReady;

  if (showMessage) {
    els.documentStatus.className =
      "document-status";

    els.documentStatus.innerHTML = markdown(
      [
        "### Document selected",
        "",
        `**File:** ${file.name}`,
        `**Size:** ${formatFileSize(file.size)}`,
        "",
        (
          `Limits: ${MAX_DOCUMENT_SIZE_MB} MB and `
          + `${MAX_DOCUMENT_PAGES} normalized-PDF pages.`
        ),
      ].join("\n"),
    );
  }

  return {
    valid: true,
    reason: "",
  };
}


function updateAskButton() {
  if (!backendReady) {
    els.ask.disabled = true;
    els.ask.textContent = "Starting backend…";
    return;
  }

  if (currentMode === "document" && !documentReady) {
    els.ask.disabled = true;
    els.ask.textContent = "Process document first";
    return;
  }

  els.ask.disabled = running;
  els.ask.textContent = running
    ? (modelReady ? "Generating answer…" : "Loading model…")
    : "Ask";
}

async function processSelectedDocument() {
  const file = els.documentFile.files?.[0];
  const validation = validateSelectedDocument({
    showMessage: true,
  });

  if (!validation.valid) return;

  if (!backendReady) {
    els.documentStatus.className =
      "document-status error";
    els.documentStatus.textContent =
      "The backend is not ready yet.";
    return;
  }

  running = true;
  disableControls(true);
  startDocumentTimer();
  latestDocumentJobSnapshot = null;
  currentDocumentJobId = "";

  els.statusUserVector.textContent =
    "◌ User vector database is being created";
  updateRuntimeIndicators({
    stateVector: "standby",
    userVector: "processing",
    gpu: "ready",
    llm: modelReady ? "ready" : "standby",
  });
  els.processDocumentButton.textContent =
    "Processing document…";
  els.documentStatus.className =
    "document-status processing";
  els.documentStatus.innerHTML = markdown(
    "### Preparing document\nUploading the file and starting a resumable processing job.",
  );
  updateAskButton();
  saveExplorerState();

  try {
    if (documentSessionId) {
      try {
        await clearDocumentSession(
          documentSessionId,
        );
      } catch (error) {
        console.warn(
          "Previous document session could not be cleared:",
          error,
        );
      }
    }

    const started =
      await startDocumentProcessingJob(
        file,
      );

    currentDocumentJobId = started.jobId;
    documentSessionId = started.sessionId;
    saveExplorerState();

    await pollDocumentProcessingJob(
      currentDocumentJobId,
    );
  } catch (error) {
    currentDocumentJobId = "";
    documentReady = false;
    els.vectorDownload.hidden = true;
    els.statusUserVector.textContent =
      "✗ User vector database creation failed";
    updateRuntimeIndicators({
      stateVector: "standby",
      userVector: "error",
      gpu: "pending",
      llm: "pending",
    });
    els.documentStatus.className =
      "document-status error";
    els.documentStatus.innerHTML = markdown(
      error?.message
      || "The document could not be processed.",
    );
    stopDocumentTimer();
    running = false;
    disableControls(false);
    els.processDocumentButton.textContent =
      "Process document";
    updateAskButton();
    saveExplorerState();
    console.error(error);
  }
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/[`*_#]/g, "")
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\\/\n]+[\\/])+/g, "")
    .replace(/\s+/g, " ")
    .trim() || "Regulatory source";
}

function sourceBlocks(raw) {
  const text = String(raw || "").replace(/\r/g, "").trim();
  if (!text) return [];

  const headings = [
    ...text.matchAll(
      /(?:^|\n)#{2,4}\s*\[(\d+)\]\s*([^\n]*)/g,
    ),
  ];

  if (headings.length) {
    return headings.map((match, index) => ({
      sourceNumber: Number(match[1]),
      heading: match[2] || `Source ${match[1]}`,
      body: text.slice(
        (match.index || 0) + match[0].length,
        index + 1 < headings.length
          ? headings[index + 1].index
          : text.length,
      ).trim(),
    }));
  }

  return [{
    sourceNumber: 1,
    heading: "Source 1",
    body: text,
  }];
}

function metadataValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\*\\*${escaped}:\\*\\*\\s*(?:\`([^\`]+)\`|([^|\\n]+))`,
    "i",
  );
  const match = text.match(pattern);
  return String(match?.[1] || match?.[2] || "").trim();
}

function removeSourceMetadata(text) {
  return String(text || "")
    .replace(
      /\*\*(?:Source|Page|Document|Jurisdiction|Retrieval distance):\*\*\s*(?:`[^`]*`|[^|\n]*)(?:\s*\|\s*)?/gi,
      "",
    )
    .replace(/^\s*---\s*$/gm, "")
    .replace(/^[ \t|]+|[ \t|]+$/gm, "")
    .trim();
}

function containsMarkdownTable(value) {
  const text = String(value || "").replace(/\r/g, "");
  return /(^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/m.test(text);
}

function safeSourceMarkdown(value) {
  const normalized = normalizeMarkdownText(
    String(value || ""),
  ).trim();

  if (!normalized) {
    return "<p>No excerpt was returned.</p>";
  }

  // Escape raw HTML first. Markdown structure such as tables, lists,
  // emphasis, and line breaks remains available, but document-provided
  // tags, styles, scripts, and presentation formatting cannot execute.
  const escaped = escapeHtml(normalized);

  return window.marked
    ? window.marked.parse(escaped, {
        gfm: true,
        breaks: true,
      })
    : `<p>${escaped}</p>`;
}

function renderSources(raw) {
  const sources = sourceBlocks(raw).map((block, index) => {
    const body = block.body;
    const documentName =
      metadataValue(body, "Document") || block.heading;
    const page = metadataValue(body, "Page");
    const jurisdiction = metadataValue(body, "Jurisdiction");
    const distance = metadataValue(body, "Retrieval distance");

    return {
      sourceNumber: block.sourceNumber || index + 1,
      title: cleanTitle(block.heading || documentName),
      documentName: cleanTitle(documentName),
      page,
      jurisdiction,
      distance,
      excerpt: removeSourceMetadata(body),
    };
  });

  els.sourceCount.textContent =
    `${sources.length} ${sources.length === 1 ? "source" : "sources"}`;
  els.sources.innerHTML = "";

  if (!sources.length) {
    els.sources.innerHTML =
      "<p>No supporting sources were returned.</p>";
    return;
  }

  sources.forEach((source) => {
    const card = document.createElement("article");
    card.className = "source-card";

    const limit = 520;
    const isLong = source.excerpt.length > limit;
    const shortExcerpt = isLong
      ? `${source.excerpt.slice(0, limit).trim()}…`
      : source.excerpt;

    const pageText =
      !source.page ||
      /^(unavailable|unknown|none|null)$/i.test(source.page)
        ? "Page unavailable"
        : `Page ${source.page.replace(/^page\s*/i, "")}`;

    const metadata = [
      pageText,
      source.documentName
        ? `Document: ${source.documentName}`
        : "",
      source.jurisdiction
        ? `Jurisdiction: ${source.jurisdiction}`
        : "",
      source.distance
        ? `Retrieval distance: ${source.distance}`
        : "",
    ].filter(Boolean);

    card.innerHTML = `
      <div class="source-card__header">
        <span class="source-card__number">
          Source ${source.sourceNumber}
        </span>
        <h3 class="source-card__title">
          ${escapeHtml(source.title)}
        </h3>
        <div class="source-card__meta">
          ${metadata.map((item) =>
            `<span>${escapeHtml(item)}</span>`
          ).join("")}
        </div>
      </div>
      <div class="source-excerpt">
        <div class="source-excerpt__content"></div>
      </div>
    `;

    const excerptContainer = card.querySelector(
      ".source-excerpt__content",
    );
    const hasTable = containsMarkdownTable(
      source.excerpt,
    );

    // Tables are rendered in full so truncation cannot break rows or the
    // Markdown separator line. Non-table excerpts retain the compact card.
    excerptContainer.innerHTML = safeSourceMarkdown(
      hasTable
        ? source.excerpt
        : shortExcerpt,
    );

    if (isLong && !hasTable) {
      const button = document.createElement("button");
      button.className = "excerpt-toggle";
      button.type = "button";
      button.textContent = "Show full excerpt";

      let open = false;
      button.onclick = () => {
        open = !open;
        excerptContainer.innerHTML = safeSourceMarkdown(
          open
            ? source.excerpt
            : shortExcerpt,
        );
        button.textContent = open
          ? "Collapse excerpt"
          : "Show full excerpt";
      };
      card.querySelector(".source-excerpt").appendChild(button);
    }

    els.sources.appendChild(card);
  });
}

function parseJourneySteps(raw) {
  const text = String(raw || "").replace(/\r/g, "").trim();
  const matches = [
    ...text.matchAll(
      /\*\*(Step\s+\d+[^*]*|Final step[^*]*|Search stopped[^*]*)\*\*/gi,
    ),
  ];

  return matches.length
    ? matches.map((match, index) => ({
        title: match[1].replace(/\s+/g, " ").trim(),
        body: text.slice(
          (match.index || 0) + match[0].length,
          index + 1 < matches.length
            ? matches[index + 1].index
            : text.length,
        ).trim(),
      }))
    : [{
        title: "Search process",
        body: text || "No search journey was returned.",
      }];
}

function renderJourneyInto(raw, target) {
  const steps = parseJourneySteps(raw);
  target.innerHTML = "";

  steps.forEach((step, index) => {
    const combined = `${step.title} ${step.body}`.toLowerCase();
    const kind =
      combined.includes("repeated") ||
      combined.includes("stopped") ||
      combined.includes("failed")
        ? "stopped"
        : combined.includes("more evidence") ||
            combined.includes("missing information")
          ? "warning"
          : combined.includes("query") ||
              combined.includes("retrieval") ||
              combined.includes("search")
            ? "info"
            : "success";

    const item = document.createElement("section");
    item.className = `journey-step journey-step--${kind}`;
    item.innerHTML = `
      <span class="journey-step__dot">${index + 1}</span>
      <h3>${escapeHtml(step.title)}</h3>
      <div class="journey-step__body">
        ${markdown(step.body || "Completed.")}
      </div>
    `;
    target.appendChild(item);
  });

  target.scrollTop = target.scrollHeight;
}

function renderJourney(raw) {
  renderJourneyInto(raw, els.journey);
}

function updateLiveJourney(raw) {
  els.liveJourneyPanel.hidden = false;
  renderJourneyInto(raw, els.liveJourney);
}

function setLiveJourneyState(text, kind = "") {
  els.liveJourneyState.textContent = text;
  els.liveJourneyState.className =
    `live-journey-state${kind ? ` is-${kind}` : ""}`;
}

function resetLiveJourney() {
  els.liveJourneyPanel.hidden = true;
  els.liveJourney.innerHTML = `
    <p class="live-journey-placeholder">
      Search details will appear here as each retrieval step completes.
    </p>
  `;
  setLiveJourneyState("Waiting");
}

function startRequestTimer() {
  clearInterval(requestTimer);
  requestStartedAt = Date.now();
  els.requestElapsed.textContent = "0:00";
  requestTimer = setInterval(() => {
    els.requestElapsed.textContent =
      elapsed(Date.now() - requestStartedAt);
  }, 1000);
}

function stopRequestTimer() {
  if (requestStartedAt !== null) {
    els.requestElapsed.textContent =
      elapsed(Date.now() - requestStartedAt);
  }
  clearInterval(requestTimer);
  requestTimer = null;
}

function synchronizeRequestStage(
  processText,
  answerText = "",
) {
  const lower = String(
    processText || "",
  ).toLowerCase();

  const usingStateDatabase =
    currentMode === "jurisdiction";

  const userState =
    documentReady
      ? "ready"
      : "empty";

  if (
    answerText ||
    lower.includes("final answer") ||
    lower.includes("generating final") ||
    lower.includes("final response")
  ) {
    modelReady = true;

    setStatus(
      "busy",
      "Generating response…",
    );

    els.loadingTitle.textContent =
      "Generating response…";
    els.loadingMessage.textContent =
      "Preparing a grounded answer and organizing the supporting sources.";
    els.progress.style.width = "88%";

    updateRuntimeIndicators({
      stateVector:
        usingStateDatabase
          ? "ready"
          : "standby",
      userVector: userState,
      gpu: "ready",
      llm: "ready",
    });
    return;
  }

  if (
    lower.includes("evidence assessment") ||
    lower.includes("more evidence needed") ||
    lower.includes("evidence sufficient") ||
    lower.includes("missing information")
  ) {
    modelReady = true;

    setStatus(
      "busy",
      "Evaluating evidence…",
    );

    els.loadingTitle.textContent =
      "Evaluating evidence…";
    els.loadingMessage.textContent =
      "Assessing whether the retrieved passages are sufficient.";
    els.progress.style.width = "68%";

    updateRuntimeIndicators({
      stateVector:
        usingStateDatabase
          ? "ready"
          : "standby",
      userVector: userState,
      gpu: "ready",
      llm: "ready",
    });
    return;
  }

  if (
    lower.includes("search query") ||
    lower.includes("retrieval result") ||
    lower.includes("retrieved ") ||
    lower.includes("passages")
  ) {
    modelReady = true;

    setStatus(
      "busy",
      usingStateDatabase
        ? "Searching regulations…"
        : "Searching document…",
    );

    els.loadingTitle.textContent =
      usingStateDatabase
        ? "Searching regulations…"
        : "Searching uploaded document…";
    els.loadingMessage.textContent =
      usingStateDatabase
        ? "Retrieving passages from the regulatory knowledge base."
        : "Retrieving passages from the temporary user vector database.";
    els.progress.style.width = "44%";

    updateRuntimeIndicators({
      stateVector:
        usingStateDatabase
          ? "ready"
          : "standby",
      userVector: userState,
      gpu: "ready",
      llm: "ready",
    });
    return;
  }

  setStatus(
    "busy",
    modelReady
      ? "Preparing search…"
      : "Loading LLM…",
  );

  els.loadingTitle.textContent =
    "Preparing the search…";
  els.loadingMessage.textContent =
    "Initializing the selected vector database and language model.";
  els.progress.style.width = "18%";

  updateRuntimeIndicators({
    stateVector:
      usingStateDatabase
        ? "loading"
        : "standby",
    userVector: userState,
    gpu: "ready",
    llm: modelReady
      ? "ready"
      : "loading",
  });
}

async function streamRagRequest(endpoint, inputs) {
  const job = client.submit(endpoint, inputs);
  let latest = {
    answer: "",
    process: "",
    sources: "",
    diagnostics: "",
  };

  for await (const event of job) {
    if (event?.type === "status") {
      if (event?.stage === "error") {
        throw new Error(
          event?.message || "The backend request failed.",
        );
      }
      continue;
    }

    if (event?.type !== "data") continue;

    const data = Array.isArray(event.data)
      ? event.data
      : [];

    latest = {
      answer: data[0] ?? latest.answer,
      process: data[1] ?? latest.process,
      sources: data[2] ?? latest.sources,
      diagnostics: data[3] ?? latest.diagnostics,
    };

    if (latest.process) {
      updateLiveJourney(latest.process);
      synchronizeRequestStage(
        latest.process,
        latest.answer,
      );
      setLiveJourneyState(
        latest.answer ? "Finalizing" : "Searching",
        "running",
      );
    }
  }

  return latest;
}

function startStages() {
  clearInterval(loadingTimer);
  loadingTimer = null;

  els.loadingTitle.textContent =
    "Preparing the search…";
  els.loadingMessage.textContent =
    "Initializing the selected vector database and language model.";
  els.progress.style.width = "18%";
}

function stopStages() {
  clearInterval(loadingTimer);
  loadingTimer = null;
  els.progress.style.width = "100%";
}




class DocumentSessionLostError extends Error {
  constructor(message) {
    super(message);
    this.name = "DocumentSessionLostError";
  }
}


function markDocumentSessionLost(message = "") {
  documentReady = false;
  documentSessionId = "";
  modelReady = false;

  els.statusUserVector.textContent =
    "✗ User vector database unavailable";

  els.statusGpu.textContent =
    "○ GPU will be rechecked after rebuilding";

  els.statusLlm.textContent =
    "○ LLM will be rechecked after rebuilding";

  updateRuntimeIndicators({
    stateVector: "standby",
    userVector: "error",
    gpu: "pending",
    llm: "pending",
  });

  const selectedFileName =
    els.documentFile.files?.[0]?.name ||
    "Previously selected document";

  const detail = String(message || "").trim();

  els.documentStatus.className =
    "document-status error document-status--session-lost";

  els.documentStatus.innerHTML = `
    <h3>Session lost — rebuild required</h3>
    <p><strong>Selected document:</strong> ${escapeHtml(selectedFileName)}</p>
    <p>
      The temporary user vector database was removed when the server
      slept, restarted, or the inactive session expired.
    </p>
    <p>
      The original document is not stored permanently. Rebuild the
      vector database before asking another question.
    </p>
    ${
      detail
        ? `<p><strong>Details:</strong> ${escapeHtml(detail)}</p>`
        : ""
    }
  `;

  els.vectorDownload.hidden = true;
  els.vectorDownload.removeAttribute("href");

  els.processDocumentButton.textContent =
    "Rebuild vector database";

  if (els.emptyTitle) {
    els.emptyTitle.textContent =
      "Rebuild your document database";
  }

  if (els.emptyMessage) {
    els.emptyMessage.textContent =
      "The previous temporary database is no longer available. Rebuild it from the selected document before asking a question.";
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function parseSystemReadiness(statusText) {
  const lower = String(statusText || "").toLowerCase();

  return {
    gpuReady:
      lower.includes("cuda available: yes") ||
      lower.includes("gpu available: yes"),
    llmReady:
      lower.includes("model loaded: yes") ||
      lower.includes("language model loaded: yes") ||
      lower.includes("model ready: yes"),
    stateVectorReady:
      lower.includes("vector database loaded in memory: yes") ||
      lower.includes("loaded vector databases: florida") ||
      lower.includes("loaded vector databases: new jersey"),
  };
}

async function revalidateBeforeQuestion() {
  backendReady = false;

  setStatus("starting", "Rechecking server…");
  els.statusBackend.textContent = "○ Rechecking server connection";
  els.statusGpu.textContent = "○ Rechecking GPU status";
  els.statusLlm.textContent = "○ Rechecking LLM status";

  if (currentMode === "document") {
    els.statusUserVector.textContent =
      "○ Rechecking user vector database";
  }

  updateRuntimeIndicators({
    stateVector:
      currentMode === "jurisdiction" ? "pending" : "standby",
    userVector:
      currentMode === "document"
        ? "processing"
        : documentReady ? "ready" : "empty",
    gpu: "pending",
    llm: "pending",
  });

  await wakeSpace(true);

  const deadline = Date.now() + MAX_WARMUP_MS;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const runtime = await fetchSpaceRuntime();
      const state = describeRuntime(runtime);

      if (
        state.type === "paused" ||
        state.type === "build_error" ||
        state.type === "runtime_error"
      ) {
        throw new Error(state.message);
      }

      if (state.type !== "running") {
        setStatus(
          "starting",
          state.type === "building"
            ? "Building backend…"
            : state.type === "scheduling"
              ? "Waiting for hardware…"
              : "Waking server…",
        );
        await wakeSpace();
        await wait(5000);
        continue;
      }

      client = await Client.connect(SPACE_ID);
      const statusResult = await client.predict(API_STATUS, []);
      const statusText = String(statusResult?.data?.[0] ?? "");
      const readiness = parseSystemReadiness(statusText);

      backendReady = true;
      modelReady = readiness.llmReady;

      els.statusBackend.textContent = "✓ Server connected";
      els.statusGpu.textContent = readiness.gpuReady
        ? "✓ GPU available"
        : "○ GPU status unavailable";
      els.statusLlm.textContent = readiness.llmReady
        ? "✓ LLM loaded"
        : "○ LLM will load for this question";

      let userVectorState = documentReady ? "ready" : "empty";

      if (currentMode === "document") {
        resetClient();

        const validation = await validateDocumentSession(
          documentSessionId,
          { forceReconnect: true },
        );

        if (!validation.valid) {
          const sessionMessage =
            validation.message ||
            (
              "The temporary user vector database was lost when the "
              + "server slept or restarted."
            );

          markDocumentSessionLost(
            sessionMessage,
          );

          throw new DocumentSessionLostError(
            sessionMessage,
          );
        }

        documentReady = true;
        userVectorState = "ready";
        els.statusUserVector.textContent =
          "✓ User vector database available";
      }

      updateRuntimeIndicators({
        stateVector:
          currentMode === "jurisdiction"
            ? readiness.stateVectorReady ? "ready" : "loading"
            : "standby",
        userVector: userVectorState,
        gpu: readiness.gpuReady ? "ready" : "pending",
        llm: readiness.llmReady ? "ready" : "loading",
      });

      setStatus(
        "busy",
        readiness.llmReady ? "Preparing search…" : "Loading LLM…",
      );

      return readiness;
    } catch (error) {
      if (
        error instanceof DocumentSessionLostError
      ) {
        throw error;
      }

      lastError = error;
      backendReady = false;
      client = null;
      resetClient();
      await wakeSpace();
      await wait(5000);
    }
  }

  throw new Error(
    lastError?.message ||
    "The WNP-ARAG server did not become ready within the allowed waiting period.",
  );
}

async function runQuestion() {
  const q = els.question.value.trim();

  if (!q) {
    els.question.setCustomValidity(
      "Enter a question before searching.",
    );
    els.question.reportValidity();
    els.question.focus();
    return;
  }

  els.question.setCustomValidity("");

  if (
    currentMode === "document"
    && !documentReady
  ) {
    els.documentStatus.className =
      "document-status error";
    els.documentStatus.textContent =
      "Process a document before asking a question.";
    return;
  }

  running = true;
  disableControls(true);
  updateAskButton();
  showState("loading");
  startRequestTimer();

  latestJobSnapshot = null;
  currentJobId = "";

  els.loadingTitle.textContent =
    "Rechecking the server…";
  els.loadingMessage.textContent =
    "Confirming the Space runtime, GPU, LLM, and selected vector database.";
  els.progress.style.width = "8%";

  els.liveJourneyPanel.hidden = false;
  els.liveJourney.innerHTML = `
    <p class="live-journey-placeholder">
      Rechecking the backend before starting retrieval…
    </p>
  `;
  setLiveJourneyState(
    "Reconnecting",
    "running",
  );

  saveExplorerState();

  try {
    await revalidateBeforeQuestion();
    startStages();

    updateRuntimeIndicators({
      stateVector:
        currentMode === "jurisdiction"
          ? "loading"
          : "standby",
      userVector:
        documentReady
          ? "ready"
          : "empty",
      gpu: "ready",
      llm:
        modelReady
          ? "ready"
          : "loading",
    });

    els.liveJourney.innerHTML = `
      <p class="live-journey-placeholder">
        The backend accepted a resumable request and is preparing the first retrieval step…
      </p>
    `;
    setLiveJourneyState(
      "Starting",
      "running",
    );

    currentJobId =
      currentMode === "document"
        ? await startDocumentRagJob(
            q,
            documentSessionId,
            Number(els.topK.value),
            Number(els.maxLoops.value),
          )
        : await startRagJob(
            q,
            currentJurisdiction,
            Number(els.topK.value),
            Number(els.maxLoops.value),
          );

    saveExplorerState();

    await pollRagJob(
      currentJobId,
    );

  } catch (error) {
    running = false;
    disableControls(false);
    updateAskButton();

    if (
      error instanceof DocumentSessionLostError
    ) {
      showResumableJobError(
        "The temporary user vector database is no longer available. Rebuild it from the selected document, then ask the question again.",
      );
      setStatus(
        "error",
        "Rebuild document DB",
      );
    } else {
      showResumableJobError(
        error?.message
        || "An unexpected error occurred.",
      );
    }

    console.error(error);
  }
}

async function clearInterface() {
  if (running) return;

  if (currentJobId) {
    try {
      await forgetRagJob(
        currentJobId,
      );
    } catch (error) {
      console.warn(
        "Saved resumable request could not be removed:",
        error,
      );
    }
  }

  currentJobId = "";
  latestJobSnapshot = null;
  currentDocumentJobId = "";
  latestDocumentJobSnapshot = null;
  clearSavedExplorerState();

  els.question.value = "";
  els.sampleSearch.value = "";
  renderSamples(sampleQuestions);
  clearResultsOnly();

  if (currentMode === "document" && documentSessionId) {
    try {
      const message = await clearDocumentSession(documentSessionId);
      els.documentStatus.className = "document-status";
      els.documentStatus.textContent = message || "Uploaded document session cleared.";
    } catch (error) {
      console.warn("Uploaded document session could not be cleared:", error);
    }

    documentSessionId = "";
    documentReady = false;
    els.documentFile.value = "";
    els.vectorDownload.hidden = true;
    els.emptyMessage.textContent =
      "Choose and process a document before asking a question.";
  }

  updateAskButton();
  els.question.focus();
}

[
  els.knowledgeSource,
  els.jurisdiction,
  els.question,
  els.topK,
  els.maxLoops,
].forEach((element) => {
  element.addEventListener(
    "change",
    saveExplorerState,
  );
});

els.question.addEventListener(
  "input",
  saveExplorerState,
);

els.ask.addEventListener("click",runQuestion);
els.knowledgeSource.addEventListener("change", changeKnowledgeSource);
els.documentFile.addEventListener(
  "change",
  () => {
    documentReady = false;
    documentSessionId = "";
    els.vectorDownload.hidden = true;

    els.statusUserVector.textContent =
      "○ User vector database not created";

    updateRuntimeIndicators({
      stateVector: "standby",
      userVector: "empty",
      gpu: "pending",
      llm: "pending",
    });

    validateSelectedDocument({
      showMessage: true,
    });

    updateAskButton();
  },
);

els.processDocumentButton.addEventListener("click", processSelectedDocument);els.clear.addEventListener("click",clearInterface);els.sampleSearch.addEventListener("input",filterSamples);els.jurisdiction.addEventListener("change",changeJurisdiction);
els.question.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();runQuestion()}});
window.addEventListener(
  "pagehide",
  () => {
    saveExplorerState();
    clearTimeout(retryTimer);
    clearTimeout(jobPollTimer);
    clearTimeout(documentJobPollTimer);
    clearInterval(elapsedTimer);
    clearInterval(loadingTimer);
    clearInterval(requestTimer);
    clearInterval(documentTimer);
  },
);
currentJurisdiction =
  els.jurisdiction.value
  || DEFAULT_JURISDICTION;
currentMode =
  els.knowledgeSource.value
  || "jurisdiction";

const savedExplorerState =
  loadExplorerState();

if (savedExplorerState) {
  restoreExplorerState();
} else {
  changeJurisdiction();
  changeKnowledgeSource();
  resetLiveJourney();
  validateSelectedDocument({
    showMessage: false,
  });
}

if (!warmupCompletedAt) {
  elapsedTimer = setInterval(
    () => {
      els.warmupElapsed.textContent =
        elapsed(Date.now() - warmupStarted);
      saveExplorerState();
    },
    1000,
  );
} else if (els.warmupElapsed) {
  els.warmupElapsed.textContent =
    elapsed(warmupCompletedAt - warmupStarted);
}

wakeSpace(true).finally(
  () => connectBackend(),
);
