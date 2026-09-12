export type UploadKind = 'csv' | 'document' | 'image' | 'audio';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const EXT: Record<UploadKind, string[]> = {
  csv: ['.csv'],
  document: ['.pdf', '.txt', '.md', '.markdown'],
  image: ['.jpg', '.jpeg', '.png', '.webp'],
  audio: ['.mp3', '.wav', '.webm', '.ogg'],
};

const MIME: Record<UploadKind, readonly string[]> = {
  csv: ['text/csv', 'application/vnd.ms-excel'],
  document: ['application/pdf', 'text/plain', 'text/markdown'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'],
};

export function isAllowedFile(file: { name: string; type?: string }, kinds: UploadKind[]): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type ?? '').toLowerCase();
  return kinds.some((kind) => {
    const byExt = EXT[kind].some((ext) => name.endsWith(ext));
    if (kind === 'csv') return byExt;
    if (byExt) return true;
    return Boolean(type) && MIME[kind].includes(type);
  });
}

export function isCsvFile(file: { name: string; type?: string }): boolean {
  return isAllowedFile(file, ['csv']);
}

export function detectUploadKind(file: { name: string; type?: string }): UploadKind | null {
  if (isAllowedFile(file, ['csv'])) return 'csv';
  if (isAllowedFile(file, ['document'])) return 'document';
  if (isAllowedFile(file, ['image'])) return 'image';
  if (isAllowedFile(file, ['audio'])) return 'audio';
  return null;
}

export function maxBytesForKinds(kinds: UploadKind[]): number {
  if (kinds.includes('audio')) return AUDIO_MAX_BYTES;
  if (kinds.includes('image') && !kinds.includes('document') && !kinds.includes('csv')) {
    return IMAGE_MAX_BYTES;
  }
  return MAX_UPLOAD_BYTES;
}

export function acceptForKinds(kinds: UploadKind[]): string {
  const tokens = kinds.flatMap((kind) => [...EXT[kind], ...MIME[kind]]);
  return [...new Set(tokens)].join(',');
}

export function kindHint(kinds: UploadKind[]): string {
  const labels: string[] = [];
  if (kinds.includes('csv')) labels.push('CSV');
  if (kinds.includes('document')) labels.push('PDF, TXT ou Markdown');
  if (kinds.includes('image')) labels.push('JPEG, PNG ou WebP');
  if (kinds.includes('audio')) labels.push('MP3, WAV, WebM ou OGG');
  const maxMb = Math.round(maxBytesForKinds(kinds) / (1024 * 1024));
  return `${labels.join(', ')} até ${maxMb} MB`;
}
