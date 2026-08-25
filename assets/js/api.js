import { Client, handle_file } from "https://cdn.jsdelivr.net/npm/@gradio/client/+esm";
import { CONFIG } from "./config.js";

let client = null;

export function resetClient() {
  client = null;
}

export async function getClient({ forceReconnect = false } = {}) {
  if (forceReconnect) resetClient();
  if (!client) client = await Client.connect(CONFIG.spaceId);
  return client;
}

export async function checkSystemStatus({ forceReconnect = false } = {}) {
  const activeClient = await getClient({ forceReconnect });
  const result = await activeClient.predict(CONFIG.endpoints.status, []);
  return result.data?.[0] ?? "";
}

export async function askQuestion(question, jurisdiction, topK, maxLoops) {
  const activeClient = await getClient();
  const result = await activeClient.predict(CONFIG.endpoints.run, [
    question,
    jurisdiction,
    Number(topK),
    Number(maxLoops),
  ]);

  const data = result.data ?? [];
  if (data.length < 4) {
    throw new Error(`Expected four outputs from the backend but received ${data.length}.`);
  }

  return {
    answer: data[0] ?? "",
    process: data[1] ?? "",
    sources: data[2] ?? "",
    diagnostics: data[3] ?? "",
  };
}

export async function clearBackendInterface() {
  const activeClient = await getClient();
  const result = await activeClient.predict(CONFIG.endpoints.clear, []);
  return result.data ?? [];
}


export async function processDocument(
  file,
  onProgress = null,
) {
  const activeClient = await getClient();

  const requestedSessionId =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(16)}${Math.random()
      .toString(16)
      .slice(2)}`;

  const job = activeClient.submit(
    CONFIG.endpoints.processDocument,
    [
      handle_file(file),
      requestedSessionId,
    ],
  );

  let latest = {
    sessionId: requestedSessionId,
    status: "",
    download: null,
    ready: false,
  };

  for await (const event of job) {
    if (
      event?.type === "status" &&
      event?.stage === "error"
    ) {
      throw new Error(
        event?.message ||
        "The document-processing request failed.",
      );
    }

    if (event?.type !== "data") continue;

    const data = Array.isArray(event.data)
      ? event.data
      : [];

    const streamedSessionId = String(
      data[0] ?? "",
    ).trim();

    latest = {
      sessionId:
        streamedSessionId ||
        latest.sessionId ||
        requestedSessionId,
      status:
        data[1] ??
        latest.status ??
        "",
      download:
        data[2] ??
        latest.download ??
        null,
      ready:
        data[3] === true,
    };

    if (
      typeof onProgress === "function"
    ) {
      onProgress(latest);
    }
  }

  if (!latest.ready) {
    const message = String(
      latest.status ||
      "Document processing did not complete successfully. "
      + "No user vector database was created.",
    ).trim();

    const error = new Error(message);
    error.documentStatus = message;
    throw error;
  }

  if (!latest.sessionId) {
    throw new Error(
      "The user vector database was created, but no document session ID was returned.",
    );
  }

  return latest;
}

export async function askDocumentQuestion(
  question,
  sessionId,
  topK,
  maxLoops,
) {
  const activeClient = await getClient();
  const result = await activeClient.predict(
    CONFIG.endpoints.runDocument,
    [
      question,
      sessionId,
      Number(topK),
      Number(maxLoops),
    ],
  );

  const data = result.data ?? [];
  if (data.length < 4) {
    throw new Error(
      `Expected four outputs from the backend but received ${data.length}.`,
    );
  }

  return {
    answer: data[0] ?? "",
    process: data[1] ?? "",
    sources: data[2] ?? "",
    diagnostics: data[3] ?? "",
  };
}


export async function validateDocumentSession(
  sessionId,
  { forceReconnect = false } = {},
) {
  if (!sessionId) {
    return {
      valid: false,
      message:
        "No uploaded-document session is active. Process the document again.",
    };
  }

  const activeClient = await getClient({ forceReconnect });
  const result = await activeClient.predict(
    CONFIG.endpoints.validateDocument,
    [sessionId],
  );
  const data = result.data ?? [];

  return {
    valid: data[0] === true,
    message: String(data[1] ?? "").trim(),
  };
}

export async function clearDocumentSession(sessionId) {
  if (!sessionId) return "";
  const activeClient = await getClient();
  const result = await activeClient.predict(
    CONFIG.endpoints.clearDocument,
    [sessionId],
  );
  return result.data?.[0] ?? "";
}


function requestedJobId() {
  return (
    globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(16)}${Math.random()
      .toString(16)
      .slice(2)}`
  );
}


export async function startDocumentProcessingJob(
  file,
  sessionId = "",
  jobId = "",
) {
  const activeClient = await getClient();
  const requestedId = jobId || requestedJobId();
  const requestedSessionId =
    sessionId || requestedJobId();

  const result = await activeClient.predict(
    CONFIG.endpoints.startDocumentProcessingJob,
    [
      handle_file(file),
      requestedSessionId,
      requestedId,
    ],
  );

  return {
    jobId: String(
      result.data?.[0] || requestedId,
    ).trim(),
    sessionId: requestedSessionId,
  };
}

export async function startRagJob(
  question,
  jurisdiction,
  topK,
  maxLoops,
  jobId = "",
) {
  const activeClient = await getClient();
  const requestedId = jobId || requestedJobId();

  const result = await activeClient.predict(
    CONFIG.endpoints.startJob,
    [
      question,
      jurisdiction,
      Number(topK),
      Number(maxLoops),
      requestedId,
    ],
  );

  return String(
    result.data?.[0] || requestedId,
  ).trim();
}

export async function startDocumentRagJob(
  question,
  sessionId,
  topK,
  maxLoops,
  jobId = "",
) {
  const activeClient = await getClient();
  const requestedId = jobId || requestedJobId();

  const result = await activeClient.predict(
    CONFIG.endpoints.startDocumentJob,
    [
      question,
      sessionId,
      Number(topK),
      Number(maxLoops),
      requestedId,
    ],
  );

  return String(
    result.data?.[0] || requestedId,
  ).trim();
}

export async function getRagJobStatus(
  jobId,
  {
    forceReconnect = false,
  } = {},
) {
  const normalizedId =
    String(jobId || "").trim();

  if (!normalizedId) {
    return {
      found: false,
      state: "missing",
      error: "No resumable request is active.",
    };
  }

  const activeClient = await getClient({
    forceReconnect,
  });

  const result = await activeClient.predict(
    CONFIG.endpoints.jobStatus,
    [normalizedId],
  );

  const raw = String(
    result.data?.[0] || "{}",
  );

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      "The backend returned an invalid resumable-job status.",
    );
  }
}

export async function forgetRagJob(jobId) {
  const normalizedId =
    String(jobId || "").trim();

  if (!normalizedId) {
    return "";
  }

  const activeClient = await getClient();
  const result = await activeClient.predict(
    CONFIG.endpoints.forgetJob,
    [normalizedId],
  );

  return String(
    result.data?.[0] || "",
  );
}
