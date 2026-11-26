// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

/** Keeps only the newest of a series of cancellable operations alive. */
export class Latest {
    private active: AbortController | undefined;

    /** The signal for a new operation; the previous one is aborted. */
    next(): AbortSignal {
        this.cancel();
        this.active = new AbortController();
        return this.active.signal;
    }

    cancel(): void {
        this.active?.abort();
        this.active = undefined;
    }
}
