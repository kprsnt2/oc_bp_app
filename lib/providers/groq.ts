import { openAiCompatibleAdapter } from "./openaiCompatible";

export const groqAdapter = openAiCompatibleAdapter(
  "groq",
  "Groq",
  "https://api.groq.com/openai/v1",
  ["GROQ_API_KEY"],
);
