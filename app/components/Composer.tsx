"use client";

import { useRef } from "react";
import type { Agent } from "@/lib/agents";
import type { MessagePart } from "@/lib/types";

function partLabel(p: MessagePart): { title: string; detail: string } {
  if (p.type === "image") {
    return {
      title: p.name ?? "image",
      detail: `${Math.round(((p.data?.length ?? 0) * 0.75) / 1024)} KB`,
    };
  }
  if (p.type === "file") return { title: p.name, detail: "file" };
  return {
    title: p.name ?? "text",
    detail: p.truncated ? "trimmed" : `${p.text.length.toLocaleString()} chars`,
  };
}

export default function Composer({
  agent,
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  pending,
  onRemove,
  onFiles,
  busyNote,
}: {
  agent: Agent;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  pending: MessagePart[];
  onRemove: (index: number) => void;
  onFiles: (files: FileList | null) => void;
  busyNote?: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = (value.trim().length > 0 || pending.length > 0) && !streaming;

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <div className="border-t border-neutral-800 bg-neutral-950">
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-neutral-800/60 px-3 py-2">
          {pending.map((p, i) => {
            const { title, detail } = partLabel(p);
            if (p.type === "image") {
              return (
                <div
                  key={i}
                  className="group relative overflow-hidden rounded-lg border border-neutral-700"
                >
                  <img
                    src={`data:${p.mime};base64,${p.data}`}
                    alt={title}
                    className="h-16 w-16 object-cover"
                  />
                  <button
                    onClick={() => onRemove(i)}
                    className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] text-white"
                    title="Remove"
                  >
                    ✕
                  </button>
                  <span className="block max-w-16 truncate px-1 py-0.5 text-[10px] text-neutral-400">
                    {title}
                  </span>
                </div>
              );
            }
            return (
              <span
                key={i}
                className="flex max-w-56 items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
              >
                <span className="truncate text-neutral-200">{title}</span>
                <span className="shrink-0 text-[10px] text-neutral-500">{detail}</span>
                <button
                  onClick={() => onRemove(i)}
                  className="shrink-0 text-neutral-500 hover:text-red-400"
                  title="Remove"
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2 p-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          title="Attach photos, PDFs, docs, sheets, slides"
          className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
        >
          📎
        </button>

        <div className="min-w-0 flex-1">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={
              agent.attachmentHint
                ? `Message ${agent.name}… (${agent.attachmentHint})`
                : `Message ${agent.name}…`
            }
            className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-sm outline-none focus:border-blue-500"
          />
          <p className="mt-1 px-1 text-[10px] text-neutral-600">
            Enter to send · Shift+Enter for a new line
            {busyNote ? ` · ${busyNote}` : ""}
          </p>
        </div>

        {streaming ? (
          <button
            onClick={onStop}
            className="shrink-0 rounded-lg border border-red-500/60 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!canSend}
            className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium transition hover:bg-blue-500 disabled:opacity-40"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
