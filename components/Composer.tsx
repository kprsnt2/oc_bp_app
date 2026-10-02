"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent } from "@/lib/agents";
import type { ProviderId } from "@/lib/types";
import {
  type Attachment,
  TOTAL_PAYLOAD_BUDGET,
  payloadBytes,
  prepareFiles,
} from "@/lib/attachments";
import { bytesHuman } from "@/lib/format";

interface Props {
  agent: Agent;
  pdfCapable: ProviderId[];
  canTranscribe: boolean;
  busy: boolean;
  streaming: boolean;
  sendKey: "enter" | "shift-enter";
  maxImages: number;
  /** text injected from an empty-state starter button */
  seed: { text: string; nonce: number } | null;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}

export default function Composer({
  agent,
  pdfCapable,
  canTranscribe,
  busy,
  streaming,
  sendKey,
  maxImages,
  seed,
  onSend,
  onStop,
}: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [processing, setProcessing] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const grow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 260)}px`;
  }, []);

  useEffect(grow, [text, grow]);

  useEffect(() => {
    if (!streaming) taRef.current?.focus();
  }, [streaming, agent.id]);

  useEffect(() => {
    if (!seed) return;
    setText((t) => (t ? `${t}\n${seed.text}` : seed.text));
    taRef.current?.focus();
    grow();
  }, [seed?.nonce, grow]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setNotice(null);

      const imageCount = attachments.filter((a) => a.kind === "image").length;
      const incomingImages = files.filter((f) => f.type.startsWith("image/")).length;
      if (imageCount + incomingImages > maxImages) {
        setNotice(`Up to ${maxImages} images per message. Remove some to add more.`);
        return;
      }

      setProcessing((n) => n + 1);
      const prepared = await prepareFiles(files, { pdfCapable, maxImages }, (a) => {
        setAttachments((prev) => [...prev, a]);
      });
      setProcessing((n) => Math.max(0, n - 1));

      const failed = prepared.filter((p) => p.error);
      if (failed.length) {
        setNotice(failed.map((f) => `${f.name}: ${f.error}`).join(" · "));
      }
      setAttachments((prev) => prev.filter((p) => !p.error));
    },
    [attachments, maxImages, pdfCapable],
  );

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const bytes = useMemo(() => {
    const attachBytes = attachments.reduce((n, a) => n + payloadBytes(a.parts), 0);
    return attachBytes + text.length;
  }, [attachments, text]);

  const overBudget = bytes > TOTAL_PAYLOAD_BUDGET;
  const canSend = !busy && !streaming && (text.trim().length > 0 || attachments.length > 0) && !overBudget;

  function submit() {
    if (!canSend) return;
    const usable = attachments.filter((a) => !a.error);
    if (!text.trim() && usable.length === 0) return;
    onSend(text.trim(), usable);
    setText("");
    setAttachments([]);
    setNotice(null);
    requestAnimationFrame(grow);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter") return;
    const wantsSend = sendKey === "enter" ? !e.shiftKey : e.shiftKey;
    if (wantsSend) {
      e.preventDefault();
      submit();
    }
  }

  // ------------------------------------------------------------- recording

  async function startRecording() {
    if (!canTranscribe) {
      setNotice("Add GROQ_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY to enable voice notes.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        await addFiles([new File([blob], `voice-note.${ext}`, { type })]);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(
        () => setRecordSeconds((s) => s + 1),
        1000,
      );
    } catch {
      setNotice("Microphone access was blocked by the browser.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const mm = String(Math.floor(recordSeconds / 60)).padStart(2, "0");
  const ss = String(recordSeconds % 60).padStart(2, "0");

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
      className={`border-t border-ink-800 bg-ink-900/95 px-3 py-3 backdrop-blur sm:px-5 ${
        dragOver ? "outline-2 -outline-offset-2 outline-accent" : ""
      }`}
    >
      {attachments.length || processing > 0 || notice ? (
        <div className="mx-auto mb-2 flex max-w-4xl flex-wrap gap-2">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
          ))}
          {processing > 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-ink-300">
              <span className="streaming-dot">●</span>
              Reading {processing} file{processing > 1 ? "s" : ""}…
            </div>
          ) : null}
          {notice ? (
            <div className="w-full rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
              {notice}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mx-auto max-w-4xl">
        <div
          className={`flex items-end gap-2 rounded-2xl border bg-ink-850 px-2 py-2 transition ${
            dragOver ? "border-accent" : "border-ink-700 focus-within:border-ink-600"
          }`}
        >
          <button
            type="button"
            title="Attach files (images, PDFs, Word, Excel, slides, text, audio)"
            onClick={() => fileRef.current?.click()}
            className="rounded-xl p-2.5 text-ink-300 transition hover:bg-ink-800 hover:text-ink-200"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m21.4 11.1-8.5 8.5a5 5 0 0 1-7-7l8.1-8.1a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 1 1-2.4-2.4l7.4-7.4" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              agent.attachmentHint
                ? `${agent.name} — ${agent.attachmentHint}`
                : `Message ${agent.name}`
            }
            className="max-h-[260px] min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] text-ink-200 outline-none placeholder:text-ink-400"
          />

          {recording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="flex items-center gap-2 rounded-xl bg-bad/15 px-3 py-2.5 text-xs font-medium text-bad ring-1 ring-bad/40"
            >
              <span className="streaming-dot">●</span>
              {mm}:{ss} · stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startRecording()}
              title={canTranscribe ? "Record a voice note" : "Needs a transcription key"}
              className="rounded-xl p-2.5 text-ink-300 transition hover:bg-ink-800 hover:text-ink-200"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="2.5" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
              </svg>
            </button>
          )}

          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded-xl border border-ink-700 bg-ink-800 px-3.5 py-2.5 text-sm font-medium text-ink-200 transition hover:bg-ink-700"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="rounded-xl bg-accent px-3.5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-ink-400">
          <span>
            {sendKey === "enter" ? "Enter" : "Shift+Enter"} to send ·{" "}
            {sendKey === "enter" ? "Shift+Enter" : "Enter"} for a new line · drag files anywhere
          </span>
          <span className={overBudget ? "text-bad" : ""}>
            {bytesHuman(bytes)} payload
            {overBudget ? " · too large, remove a file or send as text" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const isImage = attachment.kind === "image";
  return (
    <div className="flex max-w-[15rem] items-center gap-2 rounded-xl border border-ink-700 bg-ink-850 py-1.5 pr-1.5 pl-2">
      {isImage && attachment.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.previewUrl}
          alt=""
          className="h-9 w-9 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-sm">
          {attachment.kind === "audio"
            ? "🎙"
            : attachment.kind === "image"
              ? "🖼"
              : attachment.kind === "text"
                ? "📄"
                : "📎"}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink-200">{attachment.name}</span>
        <span className="block truncate text-[11px] text-ink-400">{attachment.note}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        className="rounded-lg p-1 text-ink-400 transition hover:bg-ink-700 hover:text-ink-200"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}