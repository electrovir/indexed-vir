import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {isTransactionAborted} from './is-transaction-aborted.js';

describe(isTransactionAborted.name, () => {
    it('detects an abort', () => {
        assert.isTrue(isTransactionAborted(new DOMException('gone', 'AbortError')));
    });

    it('rejects an error from the operation itself', () => {
        assert.isFalse(isTransactionAborted(new DOMException('duplicate', 'ConstraintError')));
    });

    it('rejects a thrown non-error', () => {
        assert.isFalse(isTransactionAborted('AbortError'));
    });
});
