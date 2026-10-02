"use client";

import type { ChatMessage, ProviderId } from "./types";
import { CHATS_STORE, runTx } from "./idb";

const PREFS_KEY = "aiwish:prefs";

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  return runTx<T>(CHATS_STORE, mode, fn);
}

export interface StoredChat {
  id: string;
  title: string;
  agentId: string;
  messages: ChatMessage[];
  privacy: boolean;
  tier: "fast" | "smart";
  provider: ProviderId | "auto";
  createdAt: number;
  updatedAt: number;
  lastModel?: string;
  lastProvider?: ProviderId;
}

export interface UiPrefs {
  agentId: string;
  tier: "fast" | "smart";
  provider: ProviderId | "auto";
  privacy: boolean;
  temperature?: number;
  sendKey: "enter" | "shift-enter";
  theme: "dark" | "light";
}

export async function listChats(): Promise<StoredChat[]> {
  try {
    const all = await tx<StoredChat[]>("readonly", (s) => s.getAll() as IDBRequest<StoredChat[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function getChat(id: string): Promise<StoredChat | undefined> {
  try {
    return await tx<StoredChat | undefined>("readonly", (s) => s.get(id) as IDBRequest<StoredChat | undefined>);
  } catch {
    return undefined;
  }
}

export async function putChat(chat: StoredChat): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(chat) as IDBRequest<IDBValidKey>);
  } catch {
    /* quota exceeded or private mode: history simply will not persist */
  }
}

export async function deleteChat(id: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
  } catch {
    /* ignore */
  }
}

export async function clearChats(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.clear() as IDBRequest<undefined>);
  } catch {
    /* ignore */
  }
}

export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { used: est.usage ?? 0, quota: est.quota ?? 0 };
}

export function loadPrefs(): Partial<UiPrefs> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<UiPrefs>;
  } catch {
    return {};
  }
}

export function savePrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function newChat(agentId: string, privacy: boolean): StoredChat {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    agentId,
    messages: [],
    privacy,
    tier: "smart",
    provider: "auto",
    createdAt: now,
    updatedAt: now,
  };
}

export function titleFromFirstMessage(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "New chat";
  return flat.length > 48 ? `${flat.slice(0, 48)}…` : flat;
}