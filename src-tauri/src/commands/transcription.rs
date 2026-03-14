use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, write_settings, ModelUnloadTimeout};
use rubato::{FftFixedIn, Resampler};
use serde::Serialize;
use specta::Type;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Type)]
pub struct ModelLoadStatus {
    is_loaded: bool,
    current_model: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn set_model_unload_timeout(app: AppHandle, timeout: ModelUnloadTimeout) {
    let mut settings = get_settings(&app);
    settings.model_unload_timeout = timeout;
    write_settings(&app, settings);
}

#[tauri::command]
#[specta::specta]
pub fn get_model_load_status(
    transcription_manager: State<TranscriptionManager>,
) -> Result<ModelLoadStatus, String> {
    Ok(ModelLoadStatus {
        is_loaded: transcription_manager.is_model_loaded(),
        current_model: transcription_manager.get_current_model(),
    })
}

#[tauri::command]
#[specta::specta]
pub fn unload_model_manually(
    transcription_manager: State<TranscriptionManager>,
) -> Result<(), String> {
    transcription_manager
        .unload_model()
        .map_err(|e| format!("Failed to unload model: {}", e))
}

#[derive(Clone, Serialize, Type)]
pub struct TranscribeFileProgress {
    pub percent: u8,
    pub step: String,
    pub detail: String,
}

#[derive(Serialize, Type)]
pub struct TranscribeFileResult {
    pub transcript: String,
    pub transcript_path: String,
    pub timestamps_path: String,
}

fn format_timestamp(seconds: u64) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    let s = seconds % 60;
    format!("{:02}:{:02}:{:02}", h, m, s)
}

fn resample_to_16k(samples: Vec<f32>, from_hz: u32) -> Result<Vec<f32>, String> {
    if from_hz == 16000 {
        return Ok(samples);
    }
    let chunk_size = 1024usize;
    let mut resampler = FftFixedIn::<f32>::new(from_hz as usize, 16000, chunk_size, 1, 1)
        .map_err(|e| format!("Failed to create resampler: {}", e))?;

    let mut output = Vec::new();
    let mut pos = 0;
    while pos + chunk_size <= samples.len() {
        let chunk = &samples[pos..pos + chunk_size];
        let out_frames = resampler
            .process(&[chunk], None)
            .map_err(|e| format!("Resampling error: {}", e))?;
        output.extend_from_slice(&out_frames[0]);
        pos += chunk_size;
    }
    // Process remaining samples with padding
    if pos < samples.len() {
        let mut last_chunk = samples[pos..].to_vec();
        last_chunk.resize(chunk_size, 0.0);
        let out_frames = resampler
            .process(&[&last_chunk[..]], None)
            .map_err(|e| format!("Resampling error: {}", e))?;
        let valid = (samples.len() - pos) * 16000 / from_hz as usize;
        let to_take = valid.min(out_frames[0].len());
        output.extend_from_slice(&out_frames[0][..to_take]);
    }
    Ok(output)
}

#[tauri::command]
#[specta::specta]
pub async fn transcribe_file(
    app: AppHandle,
    file_path: String,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<TranscribeFileResult, String> {
    let transcription_manager = transcription_manager.inner().clone();
    let result = tokio::task::spawn_blocking(move || {
        transcribe_file_blocking(&app, &file_path, &transcription_manager)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;
    result
}

fn transcribe_file_blocking(
    app: &AppHandle,
    file_path: &str,
    transcription_manager: &Arc<TranscriptionManager>,
) -> Result<TranscribeFileResult, String> {
    let emit_progress = |percent: u8, step: &str, detail: &str| {
        let _ = app.emit(
            "transcribe-file-progress",
            TranscribeFileProgress {
                percent,
                step: step.to_string(),
                detail: detail.to_string(),
            },
        );
    };

    // Read WAV
    emit_progress(5, "reading", "");
    let mut reader =
        hound::WavReader::open(&file_path).map_err(|e| format!("Failed to open WAV: {}", e))?;
    let spec = reader.spec();
    let channels = spec.channels as usize;
    let sample_rate = spec.sample_rate;

    // Decode all samples as f32
    let raw_samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read WAV samples: {}", e))?,
        hound::SampleFormat::Int => {
            let bits = spec.bits_per_sample;
            let max = (1i64 << (bits - 1)) as f32;
            reader
                .samples::<i32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to read WAV samples: {}", e))?
                .into_iter()
                .map(|s| s as f32 / max)
                .collect()
        }
    };

    // Mix down to mono
    emit_progress(10, "converting", "");
    let mono: Vec<f32> = if channels == 1 {
        raw_samples
    } else {
        raw_samples
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    // Resample to 16kHz
    emit_progress(15, "resampling", "");
    let resampled = resample_to_16k(mono, sample_rate)?;

    // Ensure model is loaded before transcription
    if !transcription_manager.is_model_loaded() {
        emit_progress(20, "loadingModel", "");
        let settings = get_settings(&app);
        transcription_manager
            .load_model(&settings.selected_model)
            .map_err(|e| format!("Failed to load model: {}", e))?;
    }

    // Split into 30-second chunks (480_000 samples @ 16kHz)
    const CHUNK_SAMPLES: usize = 480_000;
    let chunks: Vec<&[f32]> = resampled.chunks(CHUNK_SAMPLES).collect();
    let total_chunks = chunks.len();

    let mut all_texts: Vec<(u64, String)> = Vec::new();

    for (i, chunk) in chunks.iter().enumerate() {
        let start_sec = (i * CHUNK_SAMPLES / 16000) as u64;
        let percent = (20.0 + (i as f64 / total_chunks as f64) * 75.0) as u8;
        emit_progress(
            percent,
            "transcribing",
            &format!("{}/{}", i + 1, total_chunks),
        );
        let text = transcription_manager
            .transcribe(chunk.to_vec())
            .map_err(|e| format!("Transcription error at chunk {}: {}", i, e))?;
        all_texts.push((start_sec, text));
    }

    // Build outputs
    let plain_text: String = all_texts
        .iter()
        .map(|(_, t)| t.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let transcript_md = format!("# Transcript\n\n{}\n", plain_text.trim());
    let timestamps_md = format!(
        "# Transcript with Timestamps\n\n{}\n",
        all_texts
            .iter()
            .map(|(sec, t)| format!("[{}] {}", format_timestamp(*sec), t.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    );

    emit_progress(95, "writing", "");

    // Write files next to the source WAV, named after the WAV file
    let source_path = Path::new(&file_path);
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("transcript");
    let parent = source_path.parent().unwrap_or(Path::new(".")).to_path_buf();
    let transcript_path = parent.join(format!("{}.md", stem));
    let timestamps_path = parent.join(format!("{}_timestamps.md", stem));

    std::fs::write(&transcript_path, &transcript_md)
        .map_err(|e| format!("Failed to write transcript: {}", e))?;
    std::fs::write(&timestamps_path, &timestamps_md)
        .map_err(|e| format!("Failed to write timestamps: {}", e))?;

    Ok(TranscribeFileResult {
        transcript: plain_text,
        transcript_path: transcript_path.to_string_lossy().to_string(),
        timestamps_path: timestamps_path.to_string_lossy().to_string(),
    })
}
