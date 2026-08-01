import {assert} from '@augment-vir/assert';
import {selectFrom} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {toError} from './to-error.js';

describe(toError.name, () => {
    it('uses the error message when an error is present', () => {
        const error = toError(new DOMException('something broke', 'ConstraintError'));
        assert.instanceOf(error, Error);
        assert.deepEquals(
            selectFrom(error, {
                message: true,
                name: true,
            }),
            {
                message: 'something broke',
                name: 'ConstraintError',
            },
        );
    });

    it('falls back to a generic message when the error is null', () => {
        const error = toError(null);
        assert.instanceOf(error, Error);
        assert.strictEquals(error.message, 'IndexedDB request failed.');
    });
});
