/** Converts an IndexedDB request error into a proper {@link Error} instance. */
export function toError(
    /** The error from a failed IndexedDB request, which the spec types as nullable. */
    error: DOMException | null,
): Error {
    return error == undefined ? new Error('IndexedDB request failed.') : new Error(error.message);
}
