import { ContractError } from '../../contracts/src/project.ts';

export const MAX_FILE_BYTES = 256 * 1024;
const managedPaths = [
  /^kadmeion\.json$/,
  /^kadmeion\.lock\.json$/,
  /^pages\/[a-z0-9_-]{1,64}\.page\.json$/,
  /^content\/[a-z0-9_-]{1,64}\.content\.json$/,
  /^theme\/tokens\.json$/
];

export function assertManagedPath(path: string): void {
  if (typeof path !== 'string' || !managedPaths.some(rule => rule.test(path))) {
    throw new ContractError('VALIDATION', 'Not an approved managed project path.');
  }
}

export function assertOwnedSourcePath(path: string): void {
  const legacy = /^slots\/[a-z0-9_-]{1,64}\/index\.(tsx|css)$/;
  const versioned = /^slots\/[a-z0-9_-]{1,64}\/owned\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/component-source\.tsx$/;
  if (typeof path !== 'string' || !(legacy.test(path) || versioned.test(path))) {
    throw new ContractError('VALIDATION', 'Owned source must remain in its dedicated slot folder.');
  }
}

export function validateManagedJson(path: string, bytes: string): void {
  assertManagedPath(path);
  if (typeof bytes !== 'string' || new TextEncoder().encode(bytes).byteLength > MAX_FILE_BYTES) {
    throw new ContractError('VALIDATION', 'Managed JSON file exceeds its safe size limit.');
  }
  try {
    const parsed: unknown = JSON.parse(bytes);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected JSON object');
    }
    // Managed JSON is consumed by several editor lenses. Reject prototype
    // keys and pathological structures BEFORE they enter an application graph.
    // Do not rewrite, normalize or discard otherwise-valid unknown fields.
    const stack: Array<{value: unknown; depth: number}> = [{value: parsed, depth: 0}];
    let nodes = 0;
    while (stack.length) {
      const {value, depth} = stack.pop()!;
      if (++nodes > 8192 || depth > 32) throw new Error('Managed JSON complexity exceeded');
      if (value === null || typeof value !== 'object') continue;
      const entries = Object.entries(value);
      if (entries.length > 512) throw new Error('Managed JSON collection exceeded');
      for (const [key, child] of entries) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor' ||
            key.length > 256) throw new Error('Unsafe managed JSON property');
        stack.push({value: child, depth: depth + 1});
      }
    }
  } catch {
    throw new ContractError('VALIDATION', 'Managed file contains invalid or unsafe JSON; original bytes remain untouched.');
  }
}
