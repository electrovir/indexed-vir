/** Converts an IndexedDB request error into a proper {@link Error} instance. */
export function toError(
    /** The error from a failed IndexedDB request, which the spec types as nullable. */
    error: DOMException | null,
): Error {
    if (error == undefined) {
        return new Error('IndexedDB request failed.');
    }

    /**
     * The name is what distinguishes a lost connection (`AbortError`) from a rejected operation
     * (`ConstraintError`), so carry it over instead of leaving the generic `Error` name behind.
     */
    const converted = new Error(error.message, {
        cause: error,
    });
    converted.name = error.name;
    return converted;
}
