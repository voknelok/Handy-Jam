import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { commands } from "@/bindings";

type TranscribePhase =
  | "idle"
  | "fileSelected"
  | "transcribing"
  | "done"
  | "error";

interface TranscribeStore {
  phase: TranscribePhase;
  filePath: string | null;
  fileName: string | null;
  progress: number;
  progressStep: string;
  progressDetail: string;
  transcript: string | null;
  savedPaths: { transcript: string; timestamps: string } | null;
  error: string | null;
  copied: boolean;

  // Actions
  selectFile: () => Promise<void>;
  startTranscription: () => Promise<void>;
  copyTranscript: () => Promise<void>;
  openFolder: () => Promise<void>;
  reset: () => void;
}

let unlisten: UnlistenFn | null = null;
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

export const useTranscribeStore = create<TranscribeStore>()((set, get) => ({
  phase: "idle",
  filePath: null,
  fileName: null,
  progress: 0,
  progressStep: "",
  progressDetail: "",
  transcript: null,
  savedPaths: null,
  error: null,
  copied: false,

  selectFile: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "WAV Audio", extensions: ["wav"] }],
    });
    if (selected && typeof selected === "string") {
      set({
        filePath: selected,
        fileName: selected.split(/[\\/]/).pop() ?? null,
        phase: "fileSelected",
        transcript: null,
        savedPaths: null,
        error: null,
        progress: 0,
      });
    }
  },

  startTranscription: async () => {
    const { filePath } = get();
    if (!filePath) return;

    set({
      phase: "transcribing",
      error: null,
      transcript: null,
      savedPaths: null,
      progress: 0,
      progressStep: "",
      progressDetail: "",
    });

    // Clean up previous listener
    unlisten?.();
    unlisten = await listen<{
      percent: number;
      step: string;
      detail: string;
    }>("transcribe-file-progress", (e) => {
      set({
        progress: e.payload.percent,
        progressStep: e.payload.step,
        progressDetail: e.payload.detail,
      });
    });

    try {
      const result = await commands.transcribeFile(filePath);
      if (result.status === "error") throw new Error(result.error);
      set({
        phase: "done",
        transcript: result.data.transcript,
        savedPaths: {
          transcript: result.data.transcript_path,
          timestamps: result.data.timestamps_path,
        },
        progress: 100,
      });
    } catch (e) {
      set({ phase: "error", error: String(e) });
    } finally {
      unlisten?.();
      unlisten = null;
    }
  },

  copyTranscript: async () => {
    const { transcript } = get();
    if (!transcript) return;
    await writeText(transcript);
    set({ copied: true });
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      set({ copied: false });
      copiedTimer = null;
    }, 2000);
  },

  openFolder: async () => {
    const { savedPaths } = get();
    if (savedPaths) {
      await revealItemInDir(savedPaths.transcript);
    }
  },

  reset: () => {
    unlisten?.();
    unlisten = null;
    set({
      phase: "idle",
      filePath: null,
      fileName: null,
      progress: 0,
      progressStep: "",
      progressDetail: "",
      transcript: null,
      savedPaths: null,
      error: null,
      copied: false,
    });
  },
}));
