# S15 — single final-version runbook

## Purpose

The final version is an evidenced tree, not the branch with the most commits. S15 is the only integration/main writer after the S0 lease transfer. S0 owns requirement scope; S6/S13 independently verify behavior; S14/owner provide appropriate visual/manual evidence. This separation prevents an integrator from declaring its own untested feature finished.

## Before any merge

- Read live GitHub refs/PRs and Notion logs. Current known integration is 7d03713fbbef4f02215d38b28932ad3952adefad; main is ead5455faa2cd0d7f4aba87384215175fbe13aa0. Refresh: both can change.
- Inventory all refs, including historical backend, main, current feature branches and #26/#27 verification candidates. Record merge-base/ancestry, unique commits, patch equivalence, changed files, unresolved conflicts and exact CI. A search returning no PRs is not reliable if known direct PR reads work.
- Preserve originals; no force/reset/delete. Distinguish already-integrated security ancestors from newer feature commits in #9/#25. Never replay old security just because a PR remains open.
- Obtain sole-writer handoff. Create one candidate branch from the current integration. Never assemble whole old file snapshots over newer foreign changes.

## Initial dependency groups

1. S4 #21 + S6 method-aware fixture subset: test together. S6 migration permission tests may need #28; do not silently skip those in a release candidate. S15 can compose all coherent dependencies in one candidate or temporarily select exact test commits with patch provenance, not merge unrelated staging branches.
2. S1 #28 + S2 #24 + S13 thumbnail/CAS/permission/byte tests. Budget variance and exact responsive heading failure require resolution, not an exemption hidden in CI.
3. S3 #20 + S14 verifiedOwner shell wiring + S6 actual IndexedDB/Restore/Keep Both tests. #27 old tree is a reference for one approved prop, not current editor source.
4. S5 #9 Settings/growth source + focused export/notification/goal tests, then transfer growth to S10 and consume #28 goal/error contracts. Passing standalone baseline does not prove those consumers.

Choose order by actual disjoint paths and dependencies, not PR number. S2/S3/S5 latest standalone green work may be integrated once focused gates and current combined checks pass; no need to wait for unrelated provider credentials.

## Integration mechanics

- Prefer normal merge commits to preserve ancestry. Record expected worker head, candidate base and exact admitted commit range. Review effective file delta against candidate, not only original merge base.
- For conflicts, request intent from each file owner; review final diff against both parents. Never use blanket ours/theirs or reset the candidate to a worker tree.
- If cherry-picking an approved small dependency/test patch is necessary, record original commit, resulting commit and patch-equivalence in RELEASE_MANIFEST. Reconcile later merge so it cannot duplicate/revert the patch. Do not represent cherry-picked source as original ancestry.
- Once candidate checks complete, non-force advance integration only when it has not moved; otherwise incorporate its new head and retest affected combined behavior. S15 is sole writer, but expected-head verification still matters.
- Worker branches continue from announced integration at checkpoints; do not force everyone to sync after each documentation commit.

## Required release manifest

One row for every current PR and unique commit range: owner; original ref/head; requirement IDs; changed files; included resulting SHA/tree; disposition INCLUDED / ALREADY_INTEGRATED / SUPERSEDED_EQUIVALENT / EXCLUDED_APPROVED / PENDING; equivalence proof or exclusion reason; tested source/head/base/runner tree; test IDs/evidence; migrations; flags; hosted/manual status. No PENDING mandatory change at full completion. Preserve every historical branch and candidate explanation until final acceptance.

## Candidate freeze and exact checks

Freeze new feature admissions near H20, not bug fixes. Pin candidate source SHA and tree; run required frontend TypeScript/build/behavior/public browser and application/contracts/SQL/real authenticated browser/HTTP/Edge/email smoke checks plus new feature-specific tests. Record required skipped tests as blockers. Verify current file-budget, reference checks, accessibility reports, production dependency scan and public bundle/secrets policy. Run no destructive hosted jobs by accident. Document environment and migration versions.

Known nonfunctional targets (Lighthouse/CWV/WCAG/header/availability) require actual measurement at the specified environment, not assignment of a passing label. Full hosted/manual acceptance cannot be inferred from local CI. Review all must-have rows in REQUIREMENT_LEDGER against release criteria, including P2; an excluded feature needs an explicit owner scope decision.

## One final PR to main

1. Refresh main. Incorporate any new main commits into candidate/integration, resolve owned conflicts and test affected behavior. There must be no lost main-only change.
2. Open or update ONE integration→main PR, carrying final product behavior, actual limitations, complete manifest, migration/flag/hosted prerequisites, rollback/recovery and evidence. Worker PRs never target main. The new PR targets exact reviewed current base.
3. Confirm CI tested the actual prospective merge tree with current main, not just worker head. Pin expected head and base; any movement invalidates the approval/check applicability until reviewed.
4. Respect branch protections. Branch API currently says protected=false; do not claim protection exists. Configure rules only with relevant authority; lack of a rule is not permission to bypass checks.
5. Existing coordination forbids main/production actions. Prepare everything first, then ask for any still-missing approval of this concrete PR/SHA and scope. Main merge is separate from deploying services/migrations/public activation; obtain applicable approvals separately, not an indefinite blanket release.
6. After authorized merge, fetch main, record merge commit/tree, compare expected included content, run required post-merge checks, verify no mandatory change was lost and update Notion/handoff. If deployment is separately authorized, verify actual deployed SHA + migration set + feature flags + smoke outcomes; otherwise state code merged, not deployed.

## Failure and rollback

Do not force-reset main. Stop rollout; preserve diagnostics; fix forward or create a reviewed revert of the faulty integration unit. Database recovery is a separate tested plan: never assume reverting code reverses an applied migration or deleted data. Public visibility/privacy incidents require the approved denial/revocation path and actual host evidence. Keep last known good release and immutable artifacts where architecture permits.

## Final main acceptance record

State exact main SHA/tree, included PR/commit coverage, all 53 workflow dispositions, mandatory test outcomes, hosted versions/flags, outstanding manual/provider constraints, approved exclusions and capstone/demo state. If any mandatory feature remains pending, label the result incomplete even when main CI is green.
