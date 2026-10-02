"use client";

import { AGENT_MAP } from "@/lib/agents";
import type { StoredChat } from "@/lib/store";
import { relativeTime } from "@/lib/format";

interface Props {
  chats: StoredChat[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose?: () => void;
}

export default function Sidebar({ chats, activeId, onSelect, onNew, onDelete, onClose }: Props) {
  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex items-center gap-2 border-b border-ink-800 p-3">
        <button
          onClick={() => {
            onNew();
            onClose?.();
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-accent-soft"
        >
          <span className="text-base leading-none">＋</span> New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {chats.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-ink-400">
            No chats yet. Pick an agent and start talking — history stays in this browser.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((chat) => {
              const agent = AGENT_MAP[chat.agentId];
              const active = chat.id === activeId;
              return (
                <li key={chat.id}>
                  <div
                    className={`group flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition ${
                      active ? "bg-ink-800 ring-1 ring-ink-700" : "hover:bg-ink-850"
                    }`}
                  >
                    <button
                      onClick={() => {
                        onSelect(chat.id);
                        onClose?.();
                      }}
                      className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                    >
                      <span className="mt-0.5 shrink-0 text-sm leading-none">
                        {agent?.emoji ?? "💬"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink-200">{chat.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
                          <span className="truncate">{chat.privacy ? "private" : agent?.name}</span>
                          <span>·</span>
                          <span>{relativeTime(chat.updatedAt)}</span>
                          {chat.lastProvider ? (
                            <>
                              <span>·</span>
                              <span className="truncate">{chat.lastModel}</span>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => onDelete(chat.id)}
                      aria-label={`Delete ${chat.title}`}
                      className="mt-0.5 shrink-0 rounded-lg p-1 text-ink-400 opacity-0 transition group-hover:opacity-100 hover:bg-ink-700 hover:text-bad focus:opacity-100"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}