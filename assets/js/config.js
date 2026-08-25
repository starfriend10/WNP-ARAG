export const CONFIG = {
  spaceId: "starfriend/WNP-ARAG",
  endpoints: {
    run: "/run_rag_agent",
    clear: "/clear_interface",
    status: "/check_system_status",
    processDocument: "/process_uploaded_document",
    startDocumentProcessingJob: "/start_document_processing_job",
    runDocument: "/run_document_rag",
    validateDocument: "/validate_document_session",
    clearDocument: "/clear_document_session",
    startJob: "/start_rag_job",
    startDocumentJob: "/start_document_rag_job",
    jobStatus: "/get_rag_job_status",
    forgetJob: "/forget_rag_job",
  },

  jurisdictions: {
    fl: {
      label: "Florida",
      questionsUrl: "data/sample_questions/fl.json",
    },
    nj: {
      label: "New Jersey",
      questionsUrl: "data/sample_questions/nj.json",
    },
  },
  defaultJurisdiction: "fl",

  backendRetryIntervalMs: 15000,
  backendMaxWaitMs: 10 * 60 * 1000,
};
