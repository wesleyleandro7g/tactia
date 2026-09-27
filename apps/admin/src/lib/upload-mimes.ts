export type UploadKind = 'document' | 'image' | 'audio';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const EXT: Record<UploadKind, string[]> = {
  document: ['.pdf', '.txt', '.md', '.markdown'],
  image: ['.jpg', '.jpeg', '.png', '.webp'],
  audio: ['.mp3', '.wav', '.webm', '.ogg'],
};

const MIME: Record<UploadKind, readonly string[]> = {
  document: ['application/pdf', 'text/plain', 'text/markdown'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'],
};

export function isAllowedFile(file: { name: string; type?: string }, kinds: UploadKind[]): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type ?? '').toLowerCase();
  return kinds.some((kind) => {
    const byExt = EXT[kind].some((ext) => name.endsWith(ext));
    if (byExt) return true;
    return Boolean(type) && MIME[kind].includes(type);
  });
}

export function detectUploadKind(file: { name: string; type?: string }): UploadKind | null {
  if (isAllowedFile(file, ['document'])) return 'document';
  if (isAllowedFile(file, ['image'])) return 'image';
  if (isAllowedFile(file, ['audio'])) return 'audio';
  return null;
}

export function acceptForKinds(kinds: UploadKind[]): string {
  const tokens = kinds.flatMap((kind) => [...EXT[kind], ...MIME[kind]]);
  return [...new Set(tokens)].join(',');
}
