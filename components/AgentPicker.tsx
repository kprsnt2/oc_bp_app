"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AGENTS, CATEGORY_LABELS, CATEGORY_ORDER, getAgent } from "@/lib/agents";

interface Props {
  agentId: string;
  onChange: (id: string) => void;
  compact?: boolean;
}

export default function AgentPicker({ agentId, onChange, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const agent = getAgent(agentId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATEGORY_ORDER.map((cat) => ({
      cat,
      items: AGENTS.filter((a) => {
        if (a.category !== cat) return false;
        if (!q) return true;
        return (
          a.name.toLowerCase().includes(q) ||
          a.tagline.toLowerCase().includes(q)
        );
      }),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-left transition hover:border-ink-600 hover:bg-ink-800"
      >
        <span className="text-lg leading-none">{agent.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-200">{agent.name}</span>
          {!compact ? (
            <span className="block truncate text-xs text-ink-400">{agent.tagline}</span>
          ) : null}
        </span>
        <svg
          className={`shrink-0 text-ink-400 transition ${open ? "rotate-180" : ""}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl shadow-black/60"
        >
          <div className="border-b border-ink-800 p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search agents…"
              className="w-full rounded-lg bg-ink-850 px-3 py-2 text-sm text-ink-200 outline-none placeholder:text-ink-400 focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="max-h-[min(26rem,60dvh)] overflow-y-auto p-2">
            {groups.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink-400">No agent matches.</p>
            ) : (
              groups.map((group) => (
                <div key={group.cat} className="mb-2 last:mb-0">
                  <p className="px-3 py-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                    {CATEGORY_LABELS[group.cat]}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((a) => {
                      const active = a.id === agentId;
                      return (
                        <button
                          key={a.id}
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            onChange(a.id);
                            setOpen(false);
                            setQuery("");
                          }}
                          className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition ${
                            active ? "bg-accent/15 ring-1 ring-accent/40" : "hover:bg-ink-800"
                          }`}
                        >
                          <span className="mt-0.5 text-base leading-none">{a.emoji}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-ink-200">{a.name}</span>
                              {a.tier === "smart" ? (
                                <span className="rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">
                                  smart
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-ink-400">{a.tagline}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}