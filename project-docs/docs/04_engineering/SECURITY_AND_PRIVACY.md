# Security and Privacy Threat Model

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Assets, adversaries and trust

Assets: Auth sessions/reset links, private drafts/source/asset files, published release route authority, reviewer tokens, project links, provider facts, DevScore/goals, optional aggregate analytics, admin case evidence. Attackers: unauthenticated visitor, malicious signed-in author, account impersonator, compromised provider/webpage, abusive operator, cross-tenant signed-in account, hostile imported project ZIP.

| Threat | Severity | Mitigation / pass evidence |
|---|---|---|
| Cross-account access through tables/joins/Storage | P0 | RLS grants and policies, owner FK scope, cross-user API and signed asset tests |
| User-authored JS escapes preview/public sandbox | P0 | Fail-closed static publish, cross-origin direct-open browser matrix; no app credentials or allow-same-origin/script escape |
| Staging URL reuse/bypass | P0 | Random token hashed at rest, expiry/revocation checked by delivery; direct asset URL denies |
| Privacy-revoked content retained in immutable release | P0 | Revoke affected public route until sanitized new release verified; cache/direct URL tests |
| SSRF during live site screenshot generation | P0 | IP/redirect/DNS rebinding/metadata restrictions and hard resource/time quotas; disabled unless proven |
| Account takeover/no mandatory email confirmation | P0/P1 | Owner policy UI-12 respected; rate-limits, unique Auth states, recovery/email controls and careful trust statements; reassess before open signup |
| OAuth callback open redirect or session confusion | P0 | State/PKCE as supported; strict return allowlist; replay/expired tests |
| Admin privilege creep | P0 | Minimal roles, no impersonation or editorial edits, reasons/notices/appeal and mandatory audit evidence |
| Referrer/visitor analytics reidentification | P1 | Per-portfolio OFF default, coarse aggregates, no persistent visitor identifier/fingerprint, disclosure and bounded retention |
| False verified badge/project evidence | P1 | Verified badge from positive email ownership only; handle/source/project facts self-declared unless proven |
| Cloud quota/cost overrun | P1 | Strict ₹0 fail-closed cap, no auto-billed services, transparent status and export |
| ZIP traversal/decompression bomb | P0/P1 | Canonical paths, size/count/ratio limits, disallow symlink traversal, library-managed file constraints |
| Browser eviction, multi-tab overwrite | P1 | Dedicated project recovery, explicit browser vs folder vs cloud statuses, CAS, export and backups |

## Threat-specific controls

**Author source:** untrusted TSX/JS compiles and previews only in a tested isolated worker/origin. Do not render arbitrary source in main app DOM. Do not assume iframe sandbox is sufficient because the historical synthetic experiment found self-navigation despite sandbox/CSP. Reject unsafe public custom JS; allow controlled static output or owned source export after explicit warning.

**Auth:** password values retained only in transient memory while toggling (UI-04), cleared on route exit/session completion; no LocalStorage logging/prefill of passwords; account-neutral recovery response; verified badge only on real provider email verification. If email sender is down, do not skip required security checks silently.

**Admin:** Restricted Users and Moderation views with role proofs at RPC level; actions include documented account restrict/restore, serious-abuse temporary route suspension, notice and appeal. No impersonation, discretionary content rewriting or routine unpublished-source reading. Every privileged action produces minimal audit event even though advanced admin analytics UI is deferred.

**Privacy:** public profile and project exposures separately chosen; account erasure outside item Trash. Unlisted does not mean encrypted private. Staging server token not merely client query param+noindex. Published metadata must not expose owner email, unpublished project title or private goals.

## Required tests

RLS anonymous/owner/cross-user/operator, private-field projection, all Storage direct paths, OAuth replay and open redirect, hostile zip/source/JS, API/thumbnail SSRF, expiry/revocation and cache, quota/rate limits, CSRF/session semantics, account erasure, 15-day Trash boundary. See [`TEST_CASES.csv`](../../registers/TEST_CASES.csv) for planned NOT_RUN cases.
