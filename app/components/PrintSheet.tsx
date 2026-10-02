"use client";

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

/**
 * The only thing visible in print.
 *
 * `html[data-printing]` is set on the document root while a print target is
 * active, and the stylesheet hides everything that is not this sheet. That
 * keeps the on-screen chrome (sidebar, composer, buttons) off the paper without
 * needing a second render of the conversation.
 */
export default function PrintSheet({
  agent,
  messages,
}: {
  agent: Agent;
  messages: StoredMessage[];
}) {
  const answers = messages.filter((m) => m.role === "assistant");
  if (answers.length === 0) return null;

  return (
    <div className="print-sheet hidden">
      <style>{`@page { margin: 16mm; }`}</style>
      <header className="print-head">
        <h1>
          {agent.emoji} {agent.name}
        </h1>
        {answers.length > 1 && (
          <p className="print-sub">
            {answers.length} pages · printed {new Date().toLocaleDateString()}
          </p>
        )}
      </header>
      {answers.map((m, i) => {
        const body = textOf(m.parts);
        if (!body) return null;
        return (
          <section key={i} className={answers.length > 1 ? "print-page" : undefined}>
            <Markdown>{body}</Markdown>
          </section>
        );
      })}
    </div>
  );
}
