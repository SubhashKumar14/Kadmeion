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
  } catch {
    throw new ContractError('VALIDATION', 'Managed file must contain a JSON object; invalid bytes remain untouched.');
  }
}
