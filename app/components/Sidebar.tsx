"use client";

import { AGENTS, type AgentCategory } from "@/lib/agents";
import type { Conversation } from "@/app/lib/db";

const CATEGORY_LABELS: Record<AgentCategory, string> = {
  general: "General",
  kids: "Kids & Study",
  health: "Health & Mind",
  work: "Work & Data",
  life: "Life",
};

const CATEGORY_ORDER: AgentCategory[] = [
  "general",
  "kids",
  "health",
  "work",
  "life",
];

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString();
}

export default function Sidebar({
  conversations,
  activeId,
  agentId,
  onSelectConversation,
  onDeleteConversation,
  onNewChat,
  onSelectAgent,
  onLock,
}: {
  conversations: Conversation[];
  activeId: string | null;
  agentId: string;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewChat: () => void;
  onSelectAgent: (id: string) => void;
  onLock: () => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
      <div className="border-b border-neutral-800 p-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">✨</span>
          <span className="font-semibold">AI Wish</span>
          <button
            onClick={onLock}
            title="Lock the app"
            className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            🔒
          </button>
        </div>
        <button
          onClick={onNewChat}
          className="mt-3 w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm transition hover:bg-neutral-800"
        >
          + New chat
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length > 0 && (
          <div className="border-b border-neutral-800 p-2">
            <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Chats
            </p>
            {conversations.slice(0, 40).map((c) => {
              const agent = AGENTS.find((a) => a.id === c.agentId);
              return (
                <div
                  key={c.id}
                  className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                    c.id === activeId
                      ? "bg-neutral-800"
                      : "hover:bg-neutral-800/60"
                  }`}
                  onClick={() => onSelectConversation(c.id)}
                >
                  <span className="shrink-0">{agent?.emoji ?? "💬"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.title}</span>
                    <span className="block text-[11px] text-neutral-500">
                      {timeAgo(c.updatedAt)}
                      {c.privacy ? " · private" : ""}
                    </span>
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteConversation(c.id);
                    }}
                    title="Delete chat"
                    className="shrink-0 rounded px-1 text-neutral-600 opacity-0 hover:text-red-400 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="p-2">
          <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Agents
          </p>
          {CATEGORY_ORDER.map((cat) => {
            const agents = AGENTS.filter((a) => a.category === cat);
            if (agents.length === 0) return null;
            return (
              <div key={cat} className="mb-2">
                <p className="px-1 py-1 text-[10px] uppercase tracking-wide text-neutral-600">
                  {CATEGORY_LABELS[cat]}
                </p>
                {agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => onSelectAgent(a.id)}
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-sm transition ${
                      a.id === agentId
                        ? "bg-blue-600/20 ring-1 ring-blue-500/40"
                        : "hover:bg-neutral-800/60"
                    }`}
                  >
                    <span className="mr-1">{a.emoji}</span>
                    <span className="font-medium">{a.name}</span>
                    {a.printable && (
                      <span className="ml-1 text-[10px] text-neutral-500" title="Printable output">
                        🖨
                      </span>
                    )}
                    <span className="block text-[11px] leading-tight text-neutral-500">
                      {a.tagline}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
