// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as path from 'node:path';

/**
 * The file behind a search hit or a source: paths are relative to the
 * workspace root (`src/a.ts`, `../checkout/src/b.ts` for a linked
 * workspace) or absolute (global memories).
 */
export function resolveHitPath(root: string, hitPath: string): string {
    if (/^([A-Za-z]:[\\/]|[\\/])/.test(hitPath)) {
        return path.normalize(hitPath);
    }
    return path.resolve(root, hitPath);
}
