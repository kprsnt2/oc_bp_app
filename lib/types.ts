export type ProviderId = "openai" | "gemini" | "nvidia" | "groq";

export type ModelTier = "fast" | "smart";

export interface TextPart {
  type: "text";
  text: string;
  /** source filename, when this text was extracted from an attachment */
  name?: string;
  /** set when extraction was partial, so the UI can say so */
  truncated?: boolean;
}

export interface ImagePart {
  type: "image";
  mime: string;
  /** base64 payload, no data-url prefix */
  data: string;
  name?: string;
  /** original bytes before client-side downscaling */
  originalBytes?: number;
}

export interface FilePart {
  type: "file";
  name: string;
  mime: string;
  /** base64 payload, no data-url prefix */
  data: string;
}

export type MessagePart = TextPart | ImagePart | FilePart;

export interface MessageMeta {
  provider?: ProviderId;
  model?: string;
  label?: string;
  /** milliseconds taken to produce the message */
  ms?: number;
  /** true when the model could not finish and the text is partial */
  partial?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  parts: MessagePart[];
  meta?: MessageMeta;
}

export interface ChatRequestBody {
  messages: ChatMessage[];
  agentId: string;
  /** smart = strongest model for the primary provider, fast = quick tier */
  tier: ModelTier;
  /** optional manual pin; when set, fallback stays inside that provider */
  provider: ProviderId | "auto";
  privacy: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

/** Normalized stream events emitted by /api/chat */
export type ChatEvent =
  | { type: "start"; provider: ProviderId; model: string; label: string }
  | { type: "delta"; text: string }
  | { type: "fallback"; from: ProviderId; to: ProviderId; reason: string }
  | { type: "done"; provider: ProviderId; model: string; label: string }
  | { type: "error"; message: string };

export interface ExtractedDocument {
  name: string;
  mime: string;
  chars: number;
  text: string;
  truncated: boolean;
  kind: "pdf" | "docx" | "xlsx" | "pptx" | "csv" | "text" | "image-only";
}