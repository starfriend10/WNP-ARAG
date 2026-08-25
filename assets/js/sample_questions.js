import { CONFIG } from "./config.js";

export function getJurisdictionConfig(jurisdiction) {
  const config = CONFIG.jurisdictions[jurisdiction];
  if (!config) throw new Error(`Unsupported jurisdiction: ${jurisdiction}`);
  return config;
}

export async function loadSampleQuestions(jurisdiction) {
  const jurisdictionConfig = getJurisdictionConfig(jurisdiction);
  const response = await fetch(jurisdictionConfig.questionsUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Unable to load ${jurisdictionConfig.label} sample questions (${response.status}).`);
  }

  const payload = await response.json();
  const questions = Array.isArray(payload) ? payload : payload.questions;

  if (!Array.isArray(questions)) {
    throw new Error("The sample-question JSON does not contain a question array.");
  }

  return questions.filter(
    (item) => item && typeof item.question === "string" && item.question.trim()
  );
}
