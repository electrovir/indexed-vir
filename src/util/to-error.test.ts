import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {toError} from './to-error.js';

describe(toError.name, () => {
    it('uses the error message when an error is present', () => {
        const error = toError(new DOMException('something broke', 'ConstraintError'));
        assert.instanceOf(error, Error);
        assert.strictEquals(error.message, 'something broke');
    });

    it('falls back to a generic message when the error is null', () => {
        const error = toError(null);
        assert.instanceOf(error, Error);
        assert.strictEquals(error.message, 'IndexedDB request failed.');
    });
});
