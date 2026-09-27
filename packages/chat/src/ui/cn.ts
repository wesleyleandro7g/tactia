import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins conditional classes resolving Tailwind conflicts (server + client safe). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
