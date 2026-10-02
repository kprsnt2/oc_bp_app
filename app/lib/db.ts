import type { MessagePart } from "@/lib/types";
import { CONVERSATIONS_STORE, runTx } from "@/lib/idb";

const STORE = CONVERSATIONS_STORE;

export interface StoredMessage {
  role: "user" | "assistant";
  parts: MessagePart[];
  createdAt: number;
  /** which model actually answered, shown under the bubble */
  modelLabel?: string;
  provider?: string;
  /** set when the message is an error rather than a reply */
  error?: boolean;
}

export interface Conversation {
  id: string;
  agentId: string;
  title: string;
  privacy: boolean;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return runTx<T>(STORE, mode, run);
}

/**
 * Newest first. The list only needs id, title and agent to render the sidebar,
 * so the index read keeps full message bodies out of memory.
 */
export async function listConversations(): Promise<Conversation[]> {
  const all = await tx<Conversation[]>("readonly", (s) => s.getAll() as IDBRequest<Conversation[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getConversation(id: string): Promise<Conversation | undefined> {
  return tx<Conversation | undefined>("readonly", (s) => s.get(id) as IDBRequest<Conversation | undefined>);
}

export function putConversation(c: Conversation): Promise<IDBValidKey> {
  return tx("readwrite", (s) => s.put(c));
}

export function deleteConversation(id: string): Promise<undefined> {
  return tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

export function newConversation(agentId: string, privacy = false): Conversation {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    title: "New chat",
    privacy,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}
