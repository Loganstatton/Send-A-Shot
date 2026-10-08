/**
 * Warnings worth showing on a generation. Older records carry a note that no
 * face photo was set on the Sienna tab — that is the normal setup (identity
 * comes from the LoRA), so it is hidden.
 */
export function visibleWarnings(warnings: string[]): string[] {
  return warnings.filter((w) => !/^Face reference \(identity\) module skipped — no face reference uploaded/.test(w));
}
