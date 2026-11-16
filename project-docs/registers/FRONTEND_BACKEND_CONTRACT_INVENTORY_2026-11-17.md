# Kadmeion — Source-discovered frontend/backend operation inventory
Run `20261117-7232a31` · baseline `7232a312c821459e6d88ba400eed6a391738c979` · coordinator: S0 · contract owner: S1.

This is the **initial source inventory**, not a verified API contract or newly run integration test. Rows are discovered method declarations from [the existing browser Supabase adapter](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts). They are **UNASSESSED**, pending S1 full trace from screen through service/endpoint to RLS/persistence and response. Do not convert UNASSESSED to CONTRACT_GAP merely because the mapper is incomplete.

## Actual existing entry point and backend surfaces
- Browser adapter: `apps/auth-web/src/supabase-auth-port.ts` — existing auth session, owner REST, project/portfolio, editor, assets, release, account, growth, operations.
- Normal HTTP surfaces: `api/public-portfolio.mjs`, `api/published-identity.mjs`, `api/reviewer.mjs`, `api/unlisted.mjs`; common protected JSON boundary `api/_bounded-rpc-json.mjs`.
- Edge code: `supabase/functions/complete-private-asset/index.ts`, `supabase/functions/publish/index.ts`, `supabase/functions/purge-expired-trash/index.ts`.
- Data/auth interface definitions: `packages/contracts/src/`; editor transformations `packages/editor-core/src/`; adapters `packages/storage-adapters/src/`; RLS/schema source `supabase/migrations/`; authorization/proof tests `supabase/tests/` and `tests/`.
- Browser URL family actually visible in adapter: `/auth/v1/*`, `/rest/v1/*`, `/functions/v1/*` (verify exact path per method). Do not assume authenticated endpoints exist or accept any particular payload without tracing source and migration.
- No service-only role or privileged RPC may move to a public browser client.

## Methods to trace, by precise source line
| Existing method | Definition | Classification | Owner |
| --- | --- | --- | --- |
| signUp | [auth port L213](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L213) | UNASSESSED — SOURCE METHOD | S1 |
| signInWithPassword | [auth port L236](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L236) | UNASSESSED — SOURCE METHOD | S1 |
| getUser | [auth port L250](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L250) | UNASSESSED — SOURCE METHOD | S1 |
| resetPasswordForEmail | [auth port L272](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L272) | UNASSESSED — SOURCE METHOD | S1 |
| resend | [auth port L281](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L281) | UNASSESSED — SOURCE METHOD | S1 |
| changePasswordWithCurrentPassword | [auth port L292](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L292) | UNASSESSED — SOURCE METHOD | S1 |
| reauthenticateCurrentOwner | [auth port L323](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L323) | UNASSESSED — SOURCE METHOD | S1 |
| updateUser | [auth port L335](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L335) | UNASSESSED — SOURCE METHOD | S1 |
| signOut | [auth port L349](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L349) | UNASSESSED — SOURCE METHOD | S1 |
| signInWithOAuth | [auth port L377](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L377) | UNASSESSED — SOURCE METHOD | S1 |
| exchangeCodeForSession | [auth port L406](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L406) | UNASSESSED — SOURCE METHOD | S1 |
| acceptTokens | [auth port L437](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L437) | UNASSESSED — SOURCE METHOD | S1 |
| verifyTokenHash | [auth port L457](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L457) | UNASSESSED — SOURCE METHOD | S1 |
| readOwnerProfile | [auth port L534](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L534) | UNASSESSED — SOURCE METHOD | S1 |
| encodeURIComponent | [auth port L538](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L538) | UNASSESSED — SOURCE METHOD | S1 |
| saveOwnerProfile | [auth port L545](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L545) | UNASSESSED — SOURCE METHOD | S1 |
| listOwnerPortfolios | [auth port L572](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L572) | UNASSESSED — SOURCE METHOD | S1 |
| createOwnerPortfolio | [auth port L584](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L584) | UNASSESSED — SOURCE METHOD | S1 |
| initializeOwnerPortfolio | [auth port L595](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L595) | UNASSESSED — SOURCE METHOD | S1 |
| readOwnerPortfolio | [auth port L607](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L607) | UNASSESSED — SOURCE METHOD | S1 |
| saveOwnerPortfolio | [auth port L624](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L624) | UNASSESSED — SOURCE METHOD | S1 |
| listOwnerPortfolioRevisions | [auth port L638](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L638) | UNASSESSED — SOURCE METHOD | S1 |
| listOwnerFrozenRequests | [auth port L666](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L666) | UNASSESSED — SOURCE METHOD | S1 |
| freezeOwnerRelease | [auth port L702](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L702) | UNASSESSED — SOURCE METHOD | S1 |
| loadOwnerFrozenRelease | [auth port L715](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L715) | UNASSESSED — SOURCE METHOD | S1 |
| readOwnerRelease | [auth port L727](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L727) | UNASSESSED — SOURCE METHOD | S1 |
| issueOwnerReviewerGrant | [auth port L742](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L742) | UNASSESSED — SOURCE METHOD | S1 |
| listOwnerReviewerGrants | [auth port L758](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L758) | UNASSESSED — SOURCE METHOD | S1 |
| revokeOwnerReviewerGrant | [auth port L788](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L788) | UNASSESSED — SOURCE METHOD | S1 |
| blockOwnerReleaseCandidate | [auth port L802](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L802) | UNASSESSED — SOURCE METHOD | S1 |
| listOwnerComponents | [auth port L815](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L815) | UNASSESSED — SOURCE METHOD | S1 |
| saveOwnerComponent | [auth port L827](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L827) | UNASSESSED — SOURCE METHOD | S1 |
| listOwnerRevisions | [auth port L839](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L839) | UNASSESSED — SOURCE METHOD | S1 |
| readOwnerRevision | [auth port L857](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L857) | UNASSESSED — SOURCE METHOD | S1 |
| validateSnapshot | [auth port L870](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L870) | UNASSESSED — SOURCE METHOD | S1 |
| listOwnerAssets | [auth port L875](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L875) | UNASSESSED — SOURCE METHOD | S1 |
| uploadOwnerProjectImage | [auth port L899](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L899) | UNASSESSED — SOURCE METHOD | S1 |
| privateModeration | [auth port L989](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L989) | UNASSESSED — SOURCE METHOD | S1 |
| ownerGrowth | [auth port L1004](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1004) | UNASSESSED — SOURCE METHOD | S1 |
| ownerSettings | [auth port L1024](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1024) | UNASSESSED — SOURCE METHOD | S1 |
| ownerSharingPreferences | [auth port L1050](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1050) | UNASSESSED — SOURCE METHOD | S1 |
| readOwnerWorkspace | [auth port L1068](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1068) | UNASSESSED — SOURCE METHOD | S1 |
| setPrivateOnboardingStep | [auth port L1127](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1127) | UNASSESSED — SOURCE METHOD | S1 |
| listOwnerProjects | [auth port L1171](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1171) | UNASSESSED — SOURCE METHOD | S1 |
| readOwnerProject | [auth port L1186](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1186) | UNASSESSED — SOURCE METHOD | S1 |
| readOwnerCaseStudy | [auth port L1201](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1201) | UNASSESSED — SOURCE METHOD | S1 |
| saveOwnerCaseStudy | [auth port L1216](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1216) | UNASSESSED — SOURCE METHOD | S1 |
| saveOwnerProject | [auth port L1232](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1232) | UNASSESSED — SOURCE METHOD | S1 |
| createPrivateProject | [auth port L1255](https://github.com/SubhashKumar14/Kadmeion/blob/7232a312c821459e6d88ba400eed6a391738c979/apps/auth-web/src/supabase-auth-port.ts#L1255) | UNASSESSED — SOURCE METHOD | S1 |

## Required record fields for each operation
| Field | Required determination |
| --- | --- |
| Requirement / screen / workflow | Stable IDs from source registers; consumer handler |
| Browser adapter and actual endpoint | Exact method + URL path/RPC/function + defining implementation |
| HTTP contract | Method, typed request, response, status/errors, pagination/limits |
| Authorization | Auth session; owner/filter/RLS/role; anonymous/foreign negative cases |
| Concurrency/retry | Idempotency key, conditional revision/update, stale response, retry boundaries |
| Persistence | Underlying tables/storage; post-write readback and same-owner verification |
| Provenance | Exact source path/line, migration, current commit |
| Verification | Local contract, browser, DB, hosted and manual status separately |
| Classification | VERIFIED_EXISTING / EXISTS_UNWIRED / CONTRACT_GAP / DEPLOYMENT_GAP / EXTERNAL_PROOF_REQUIRED / DEFERRED_APPROVED |
| Owner | S1 contract changes, frontend consumer and S6 independent acceptance |

## Highest priority dependency contracts
1. AUTH-01–06: password signup/signin, local session, safe OAuth redirect and recovery; signup need not wait for confirmation under latest owner instruction, while email/host proof stays separate.
2. WORK-01–08: onboarding, owner profile and projects/case studies, private portfolio list/create/chooser and persisted reload.
3. EDIT-01–09: versioned editor snapshot, optimistic revision, typed slots, reusable components, draft/offline journal and preview mode isolation.
4. PUBLISH-01–04 and PUBLIC-01–04: staging token/grants, freeze preflight, approved host gates and route/media verification, static export, revoke/rollback.
5. GROWTH-01–06, SET-01–07, OPS-01–03: provenance-gated optional provider data, consent and counters, recovery/trash/account exit, strictly privileged moderation/appeals.
6. SYS-01–02: accurate deny/offline/expired/unsupported-device branches.

**Next S1 action:** replace every UNASSESSED row with verifiable contract IDs and source/migration/proof. Publish first only truly stable operations to unblock dependent workers. Historical smoke/CI statuses are not hosted evidence for a new SHA.
