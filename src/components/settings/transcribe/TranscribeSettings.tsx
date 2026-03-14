import React from "react";
import { useTranslation } from "react-i18next";
import { useTranscribeStore } from "@/stores/transcribeStore";
import { Button } from "@/components/ui/Button";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import {
  Upload,
  FileAudio,
  Play,
  Copy,
  Check,
  FolderOpen,
} from "lucide-react";

const WaveformBars: React.FC = () => (
  <>
    <style>{`
      @keyframes transcribe-bar-pulse {
        0%, 100% { transform: scaleY(0.3); opacity: 0.5; }
        50% { transform: scaleY(1); opacity: 1; }
      }
    `}</style>
    <div className="flex items-end gap-1 h-8">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="w-1 h-full rounded-full bg-logo-primary origin-bottom"
          style={{
            animation: `transcribe-bar-pulse 1.2s ease-in-out ${i * 0.1}s infinite`,
          }}
        />
      ))}
    </div>
  </>
);

const ProgressRing: React.FC<{ percent: number }> = ({ percent }) => {
  const radius = 52;
  const stroke = 6;
  const normalizedRadius = radius - stroke / 2;
  const circumference = 2 * Math.PI * normalizedRadius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={radius * 2} height={radius * 2} className="-rotate-90">
        <circle
          cx={radius}
          cy={radius}
          r={normalizedRadius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-mid-gray/20"
        />
        <circle
          cx={radius}
          cy={radius}
          r={normalizedRadius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="text-logo-primary"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            transition: "stroke-dashoffset 0.5s ease-out",
          }}
        />
      </svg>
      <span className="absolute text-2xl font-bold text-text">
        {Math.round(percent)}%
      </span>
    </div>
  );
};

export const TranscribeSettings: React.FC = () => {
  const { t } = useTranslation();
  const {
    phase,
    fileName,
    filePath,
    progress,
    progressStep,
    progressDetail,
    transcript,
    savedPaths,
    error,
    copied,
    selectFile,
    startTranscription,
    copyTranscript,
    openFolder,
  } = useTranscribeStore();

  const isTranscribing = phase === "transcribing";

  // Parse chunk info from progressDetail (e.g. "3/7")
  const chunkMatch = progressDetail.match(/^(\d+)\/(\d+)$/);

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4">
      {/* Dropzone */}
      <button
        type="button"
        onClick={selectFile}
        disabled={isTranscribing}
        className="w-full rounded-xl border-2 border-dashed border-mid-gray/30 hover:border-logo-primary/50 transition-colors p-8 flex flex-col items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-transparent"
      >
        {fileName ? (
          <>
            <FileAudio size={40} className="text-logo-primary" />
            <p className="text-base font-semibold text-text truncate max-w-full">
              {fileName}
            </p>
            <Button
              variant="ghost"
              size="sm"
              tabIndex={-1}
              className="pointer-events-none"
            >
              {t("transcribe.dropzone.change")}
            </Button>
          </>
        ) : (
          <>
            <Upload size={40} className="text-mid-gray" />
            <p className="text-sm text-mid-gray">
              {t("transcribe.dropzone.title")}
            </p>
            <Button
              variant="primary-soft"
              size="sm"
              tabIndex={-1}
              className="pointer-events-none"
            >
              {t("transcribe.dropzone.browse")}
            </Button>
          </>
        )}
      </button>

      {/* Transcribe button */}
      {filePath && !isTranscribing && phase !== "done" && (
        <Button
          variant="primary"
          size="lg"
          className="w-full flex items-center justify-center gap-2"
          onClick={startTranscription}
          disabled={!filePath}
        >
          <Play size={18} />
          {t("transcribe.transcribe")}
        </Button>
      )}

      {/* Progress visualization */}
      {isTranscribing && (
        <div className="flex flex-col items-center gap-4 py-4">
          <WaveformBars />
          <ProgressRing percent={progress} />
          <div className="flex items-center gap-2 text-sm text-mid-gray">
            <span className="w-2 h-2 rounded-full bg-logo-primary animate-pulse" />
            {t(`transcribe.steps.${progressStep}`, {
              defaultValue: progressStep,
            })}
          </div>
          {chunkMatch && (
            <p className="text-xs text-mid-gray">
              {t("transcribe.progress.chunk", {
                current: chunkMatch[1],
                total: chunkMatch[2],
              })}
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-500">
          {t("transcribe.error", { message: error })}
        </div>
      )}

      {/* Result */}
      {savedPaths && transcript && (
        <SettingsGroup title={t("transcribe.result.title")}>
          <div className="p-4 space-y-4">
            {/* Success banner */}
            <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-500">
              {t("transcribe.result.savedFiles", {
                transcript: savedPaths.transcript.split(/[\\/]/).pop(),
                timestamps: savedPaths.timestamps.split(/[\\/]/).pop(),
              })}
            </div>

            {/* Transcript */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-mid-gray uppercase tracking-wide">
                {t("transcribe.result.transcript")}
              </p>
              <div className="p-3 rounded-lg bg-mid-gray/10 text-sm max-h-48 overflow-y-auto whitespace-pre-wrap text-text">
                {transcript}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={copyTranscript}
                className="flex items-center gap-1.5"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t("transcribe.copied") : t("transcribe.copy")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={openFolder}
                className="flex items-center gap-1.5"
              >
                <FolderOpen size={14} />
                {t("transcribe.openFolder")}
              </Button>
            </div>
          </div>
        </SettingsGroup>
      )}
    </div>
  );
};
