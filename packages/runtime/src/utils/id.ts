/**
 * Generate a unique mutation ID.
 */
export function generateMutationId(): string {
  return `mut_${crypto.randomUUID()}`;
}
