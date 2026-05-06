export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 30;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

export type ValidationResult =
  | { ok: true; kind: 'image' | 'video' }
  | { ok: false; reason: string };

export function validateFileType(file: File): ValidationResult {
  if (IMAGE_TYPES.has(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, reason: `Image exceeds 20 MB (${formatBytes(file.size)}).` };
    }
    return { ok: true, kind: 'image' };
  }
  if (VIDEO_TYPES.has(file.type)) {
    if (file.size > MAX_VIDEO_BYTES) {
      return { ok: false, reason: `Video exceeds 50 MB (${formatBytes(file.size)}).` };
    }
    return { ok: true, kind: 'video' };
  }
  return {
    ok: false,
    reason: `Unsupported format. Accepted: JPG, PNG, WEBP, MP4, WEBM.`,
  };
}

/** Probes a video element for duration. Resolves to seconds, or rejects on error. */
export function probeVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      resolve(video.duration);
      video.src = '';
    };
    video.onerror = () => reject(new Error('Could not read video metadata.'));
    video.src = url;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
