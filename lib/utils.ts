import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Conditional class helper. clsx handles truthy chains; twMerge dedupes
 * conflicting Tailwind classes so the last write wins.
 *
 *   cn("p-4", isOpen && "p-6") → "p-6" when isOpen, "p-4" otherwise
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
