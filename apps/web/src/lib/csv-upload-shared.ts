export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function isCsvFile(file: { name: string; type?: string }): boolean {
  return file.name.toLowerCase().endsWith('.csv');
}
