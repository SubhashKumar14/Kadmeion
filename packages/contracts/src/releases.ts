export type ReleaseState = 'DRAFT' | 'FROZEN' | 'BLOCKED' | 'BUILT' | 'UPLOADED' | 'LIVE' | 'REVOKED';
export interface PublishPreflight {
  revision: number;
  blockers: readonly string[];
  warnings: readonly string[];
  verifiedHost: boolean;
  containsUntrustedJavaScript: boolean;
}
/** Fail closed: B0 does not grant permission to publish. */
export function isPublishEligible(check: PublishPreflight): boolean {
  return Number.isSafeInteger(check.revision) && check.revision >= 0 &&
    check.blockers.length === 0 && check.verifiedHost && !check.containsUntrustedJavaScript;
}
