"use client";

import { useEffect, useRef, useState } from "react";
import type { Agent } from "@/lib/agents";
import type { StoredMessage } from "@/app/lib/db";
import type { MessagePart } from "@/lib/types";
import { Markdown } from "./Markdown";

function textOf(parts: MessagePart[]): string {
  return parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

function Attachments({ parts }: { parts: MessagePart[] }) {
  const images = parts.filter((p): p is Extract<MessagePart, { type: "image" }> => p.type === "image");
  const docs = parts.filter((p) => p.type !== "image");

  if (!images.length && !docs.length) return null;

  return (
    <div className="mb-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <a
              key={i}
              href={`data:${img.mime};base64,${img.data}`}
              target="_blank"
              rel="noreferrer"
              title={img.name ?? "image"}
              className="block"
            >
              <img
                src={`data:${img.mime};base64,${img.data}`}
                alt={img.name ?? "attachment"}
                className="max-h-44 rounded-lg border border-neutral-700 object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {docs.map((p, i) => (
            <span
              key={i}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-400"
            >
              📄 {p.type === "text" ? p.name ?? "text" : p.name}
              {p.type === "text" && p.truncated ? " · trimmed" : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MessageList({
  messages,
  agent,
  streaming,
  onRegenerate,
  onPrintMessage,
  fallbackNote,
}: {
  messages: StoredMessage[];
  agent: Agent;
  streaming: boolean;
  onRegenerate: () => void;
  onPrintMessage: (index: number) => void;
  fallbackNote: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function copy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      {messages.length === 0 && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
          <div className="text-3xl">{agent.emoji}</div>
          <h2 className="mt-2 text-lg font-semibold">{agent.name}</h2>
          <p className="text-sm text-neutral-400">{agent.tagline}</p>
          {agent.attachmentHint && (
            <p className="mt-1 text-xs text-neutral-500">
              Reads well with: {agent.attachmentHint}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {agent.starters.map((s) => (
              <Starter key={s} text={s} />
            ))}
          </div>
        </div>
      )}

      {fallbackNote && (
        <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {fallbackNote}
        </div>
      )}

      <div className="space-y-5">
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          const body = textOf(m.parts);
          const isLast = i === messages.length - 1;
          return (
            <div key={i} className={isUser ? "flex justify-end" : ""}>
              <div className={isUser ? "max-w-[85%]" : "w-full"}>
                {!isUser && (
                  <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
                    <span>{agent.emoji}</span>
                    <span>{agent.name}</span>
                    {m.modelLabel && <span>· {m.modelLabel}</span>}
                    {m.error && <span className="text-red-400">· failed</span>}
                  </div>
                )}
                <div
                  className={
                    isUser
                      ? "rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm"
                      : `rounded-2xl rounded-bl-sm border px-4 py-3 text-sm ${
                          m.error
                            ? "border-red-800 bg-red-950/40 text-red-200"
                            : "border-neutral-800 bg-neutral-900"
                        }`
                  }
                >
                  {isUser && <Attachments parts={m.parts} />}
                  {body ? (
                    <Markdown>{body}</Markdown>
                  ) : (
                    <span className="text-neutral-500">
                      {streaming && isLast ? "thinking…" : "(empty)"}
                    </span>
                  )}
                </div>

                {!isUser && body && (
                  <div className="mt-1 flex gap-2 text-[11px] text-neutral-500">
                    <button onClick={() => copy(body, i)} className="hover:text-neutral-200">
                      {copied === i ? "copied" : "copy"}
                    </button>
                    <button onClick={onRegenerate} className="hover:text-neutral-200">
                      regenerate
                    </button>
                    <button
                      onClick={() => onPrintMessage(i)}
                      className="hover:text-neutral-200"
                    >
                      print
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div ref={endRef} />
    </div>
  );
}

function Starter({ text }: { text: string }) {
  return (
    <button
      onClick={() =>
        window.dispatchEvent(new CustomEvent("aiwish:starter", { detail: text }))
      }
      className="rounded-full border border-neutral-700 px-3 py-1.5 text-left text-xs text-neutral-300 transition hover:border-blue-500 hover:text-neutral-100"
    >
      {text}
    </button>
  );
}
