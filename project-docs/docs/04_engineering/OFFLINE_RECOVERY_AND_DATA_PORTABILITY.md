# Browser Storage, Offline Editing, Recovery and Import/Export

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Approved compromise:** Authentication is required *to begin authoring* (UI-110), but a previously authenticated owner's existing local project should remain recoverable during provider outages without pretending a new unauthenticated account was created. The exact expired-session offline write boundary requires implementation threat-model testing; do not grant broad guest authoring automatically.

## Storage adapters

| Adapter | Scope | Reliability qualification |
|---|---|---|
| Browser IndexedDB | Versioned local committed files, dirty buffers and journal | Browser data may be evicted, private mode may have special limits; display backup advice |
| Local folder adapter | User-selected directory on browsers that actually support API | Permissions may disappear, no guaranteed cross-file atomicity; use journal/before-images and content hashes |
| Supabase cloud | Owner scoped files/revisions and account synchronization | RLS/quotas/backend outage; never falsely mark cloud sync after browser-only commit |
| Project ZIP | Portable managed/owned files and assets | Explicit export/restore; no secrets or raw private provider data |
| Static ZIP | Independent visitor HTML/CSS/media and metadata | User can host independently; export limitations for custom JS disclosed |

## Recovery state machine

- Local buffer pending validation → commit browser revision → optionally save selected local directory → optionally sync cloud with compare-and-swap. A successful first step does not imply later acknowledgments.
- External file changed since base → freeze conflicting write, show Compare/Keep Both, never clobber. On invalid text preserve precise original and stale last-good preview.
- Provider loss → existing local copy can remain accessible subject to previously established user authorization and browser capabilities; show offline, disable cloud-only operations, allow appropriate export without leaking private account data.
- Browser quota/storage eviction risk → proactive visible export/backups and accurate failure messaging; do not claim unlimited offline persistence.
- Imported ZIP → verify path safety, type, manifest/lock and expected file hashes; map version migration only through tested path and preserve unrecognized owned files.

## Portability acceptance tests

1. Export editable ZIP and static ZIP; inspect each archive to ensure tokens/credentials absent.
2. Simulate two tabs committing conflicting changes, verify both survive via resolve/keep copy.
3. Revoke folder permission midway through multi-file patch; journal recovers or quarantines partial result.
4. Disable network with an existing local editor fixture; show truthful save/export limitations and no fake successful cloud publication.
5. Open static release on an independent HTTP server with JavaScript disabled; test SEO/headings/links/assets.
