"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";
import type { Agent } from "@/lib/agents";
import type { ChatMessage } from "@/lib/types";
import { dataUrlOf, displayText, partSummary } from "@/lib/format";

interface Props {
  message: ChatMessage;
  agent: Agent;
  onRegenerate?: () => void;
  onPrint?: (html: string, title: string) => void;
  isLast?: boolean;
}

export default function MessageBubble({ message, agent, onRegenerate, onPrint, isLast }: Props) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
  const shown = displayText(text);

  const images = message.parts.filter(
    (p): p is Extract<(typeof message.parts)[number], { type: "image" }> => p.type === "image",
  );
  const files = message.parts.filter(
    (p): p is Extract<(typeof message.parts)[number], { type: "file" }> => p.type === "file",
  );
  const attachSummary = partSummary(message.parts);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown.text || text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className={`flex gap-3 px-3 sm:px-5 ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex min-w-0 max-w-[min(46rem,92%)] flex-col ${isUser ? "items-end" : "items-start"}`}>
        {!isUser ? (
          <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-400">
            <span>{agent.emoji}</span>
            <span className="font-medium text-ink-300">{agent.name}</span>
            {message.meta?.label ? (
              <span className="rounded-full bg-ink-800 px-2 py-0.5 text-ink-400">
                {message.meta.label}
                {message.meta.ms ? ` Â· ${(message.meta.ms / 1000).toFixed(1)}s` : ""}
              </span>
            ) : null}
            {message.meta?.partial ? (
              <span className="rounded-full bg-bad/15 px-2 py-0.5 text-bad">stopped early</span>
            ) : null}
          </div>
        ) : null}

        <div
          className={`w-full rounded-2xl px-4 py-3 ${
            isUser
              ? "bg-accent/12 text-ink-200 ring-1 ring-accent/25"
              : "bg-ink-900 text-ink-200 ring-1 ring-ink-800"
          }`}
        >
          {shown.text ? (
            isUser ? (
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{shown.text}</p>
            ) : (
              <Markdown>{shown.text}</Markdown>
            )
          ) : null}

          {shown.docs.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {shown.docs.map((name) => (
                <span
                  key={name}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-2 py-1 text-[11px] text-ink-300"
                >
                  ðŸ“„ <span className="truncate">{name}</span>
                  <span className="text-ink-400">Â· text extracted</span>
                </span>
              ))}
            </div>
          ) : null}

          {files.length ? (
            <div className="mt-2 space-y-1">
              {files.map((f) => (
                <div
                  key={f.name}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-2 py-1 text-[11px] text-ink-300"
                >
                  ðŸ“Ž <span className="truncate">{f.name}</span>
                </div>
              ))}
            </div>
          ) : null}

          {images.length ? (
            <div
              className={`mt-2 grid gap-1.5 ${
                images.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"
              }`}
            >
              {images.map((img, i) => (
                <a
                  key={i}
                  href={dataUrlOf(img.mime, img.data)}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-xl border border-ink-700"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={dataUrlOf(img.mime, img.data)}
                    alt=""
                    loading="lazy"
                    className="max-h-64 w-full object-contain"
                  />
                </a>
              ))}
            </div>
          ) : null}

          {isUser && attachSummary ? (
            <p className="mt-1.5 text-[11px] text-ink-400">{attachSummary}</p>
          ) : null}
        </div>

        {!isUser && shown.text ? (
          <div className="mt-1 flex items-center gap-1 text-ink-400">
            <ActionButton onClick={copy}>{copied ? "Copied" : "Copy"}</ActionButton>
            {onRegenerate ? (
              <ActionButton onClick={onRegenerate}>Regenerate</ActionButton>
            ) : null}
            {onPrint && agent.printable ? (
              <ActionButton
                onClick={() => onPrint(shown.text, `${agent.name} â€” worksheet`)}
              >
                Print
              </ActionButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-2 py-1 text-[11px] transition hover:bg-ink-800 hover:text-ink-200"
    >
      {children}
    </button>
  );
}