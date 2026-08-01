/**
 * Whether the given error means an IndexedDB transaction was aborted, which is how a connection
 * closed mid-transaction surfaces on the requests that were still in flight. Errors from the
 * operation itself, such as `ConstraintError`, keep their own names.
 */
export function isTransactionAborted(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}
