"use client";

import { useRef, useState, type DragEvent } from "react";
import { useI18n } from "@/lib/i18n/client";
import { CameraIcon, ImageIcon } from "./icons";

export const SAMPLES = [
  { id: "room", src: "/samples/room.jpg", labelKey: "upload.sampleRoom" },
  { id: "facade", src: "/samples/facade.jpg", labelKey: "upload.sampleFacade" },
] as const;

type Props = {
  busy: boolean;
  error: string | null;
  /** A saved session that can be continued (shown above the upload area). */
  resume?: { thumbUrl: string; savedAt: number; onResume: () => void } | null;
  onFile: (file: File) => void;
  onSample: (src: string) => void;
};

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

export function UploadPanel({ busy, error, resume, onFile, onSample }: Props) {
  const { t, locale } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-8" aria-labelledby="upload-title">
      {resume && !busy && (
        <div className="mb-6 flex items-center gap-4 rounded-3xl border-2 border-brand-500 bg-brand-50 p-4" data-testid="resume">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resume.thumbUrl} alt="" className="h-20 w-28 shrink-0 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t("upload.resumeTitle")}</p>
            <p className="text-sm text-muted">
              {t("upload.resumeText")} ·{" "}
              {new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : locale, { dateStyle: "short", timeStyle: "short" }).format(resume.savedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={resume.onResume}
            data-testid="resume-button"
            className="min-h-12 shrink-0 rounded-full bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700"
          >
            {t("upload.resume")}
          </button>
        </div>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`rounded-3xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-brand-500 bg-brand-50" : "border-line bg-surface"
        }`}
      >
        <h1 id="upload-title" className="text-2xl font-bold">
          {t("upload.title")}
        </h1>
        <p className="mt-2 text-sm text-muted">{t("upload.hint")}</p>

        {busy ? (
          <p role="status" className="mt-8 flex items-center justify-center gap-3 text-brand-700">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden />
            {t("upload.processing")}
          </p>
        ) : (
          <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700"
            >
              <ImageIcon /> {t("upload.choose")}
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-brand-600 px-6 font-semibold text-brand-700 hover:bg-brand-50"
            >
              <CameraIcon /> {t("upload.camera")}
            </button>
          </div>
        )}
        <p className="mt-4 hidden text-sm text-muted sm:block">{t("upload.drop")}</p>

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-white p-4" data-testid="photo-tips">
        <h2 className="font-semibold">{t("upload.tipsTitle")}</h2>
        <ul className="mt-2 flex flex-col gap-2 text-base">
          {(["upload.tip1", "upload.tip2", "upload.tip3"] as const).map((k, i) => (
            <li key={k} className="flex items-center gap-3">
              <span aria-hidden className="text-xl">{["☀️", "↔️", "📱"][i]}</span>
              {t(k)}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 flex items-start gap-2 text-sm text-muted" data-testid="privacy-note">
        <span aria-hidden>🔒</span>
        {t("upload.privacy")}
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-center text-sm text-red-800">
          {error}
        </p>
      )}

      <h2 className="mt-8 text-center text-sm font-semibold text-muted">{t("upload.samples")}</h2>
      <ul className="mt-3 grid grid-cols-2 gap-3">
        {SAMPLES.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSample(s.src)}
              className="group block w-full overflow-hidden rounded-2xl border border-line bg-surface text-start disabled:opacity-50"
              data-testid={`sample-${s.id}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt="" className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]" loading="lazy" />
              <span className="block px-3 py-2 text-sm font-medium">{t(s.labelKey)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
