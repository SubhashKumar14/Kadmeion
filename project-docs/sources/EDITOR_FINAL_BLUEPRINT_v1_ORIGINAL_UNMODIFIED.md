# Kadmeion — Final Portfolio Builder/Editor Blueprint

**Version:** 1.0 (planning synthesis) · **As-of:** 12 November 2026 · **Status:** SPECIFICATION ONLY — no application code, build, test, migration, provider configuration or deployment was performed.  
**Product:** Kadmeion (formerly DevFolio) · **Tagline:** *Build · Showcase · Evolve* · **Owner constraints:** one student engineer, MIT for Kadmeion source, open-source software only, ₹0 target / ₹1,000 total cap, no paid APIs, no CLI in v1, demonstrable without any cloud service, flexible timeline.

**Evidence notation:** **[D]** explicit owner decision; **[C]** architect-selected design under delegation; **[V]** independently checked public documentation (source and retrieval date in §19); **[S]** experimentally unproven, needs a named spike; **[A]** assumption/threshold, not a promise. A checked vendor claim does **not** establish Kadmeion integration feasibility. All user-selected features are intended behavior, not implemented behavior.

## 0. Reading guide and what was actually reviewed

**Six distinct Markdown research documents** were read from their first line to end marker and then independently parsed in a second source-coverage pass. Five older attachments are exact byte-for-byte duplicates of five newer attachments: 11 attached Markdown files, **6 unique contents**. The six are: *Hybrid Blueprint*, *Editor Spec A*, *Editor Perspective B*, *Portfolio Builder Task 1*, *Task 2*, and *Task 3*. Exact filenames, byte/line totals, SHA-256 prefixes, duplicate relationships and all original headings are enumerated in Appendix A and Appendix G. All six text files were accessible; none was truncated at the filesystem level. **The original five wireframe image files and the untruncated owner feature-table rows 1, 2, 9–12 were not among these 11 current attachments.** Their visuals/rows have not been invented; text descriptions of L1–L5 are used provisionally. The earlier normalized D01–D90 decision context informs product boundaries, but is *not* an exact replacement for the missing pasted feature-table rows.

**Read in order:** §1 (architecture ruling) → §2 (authority and choices) → §3 (requirement traceability) → §4–§10 (buildable mechanism) → §11–§15 (platform and safety) → §16–§18 (risks, completeness and open questions) → §19–§20 (verification and glossary) → appendices (complete source/ID coverage, historical boons/banes, audit).

## 1. Final ruling and release boundary

### 1.1 Chosen mechanism [C]

**A safety-first, files-exposed, contract-driven editor with one transactional writer.** A Kadmeion portfolio is a versioned folder of readable structured files plus opaque custom-code files. The **committed project file set** is the durable source of truth; the **parsed project graph** is its validated in-memory representation. Every interface—canvas, content panel, theme inspector, composition-code editor, layers tree, preview and history—is a *view* of the same committed revision. They submit **typed intent operations** to one engine. No panel writes a second, divergent copy of the portfolio.

- **From Spec A / Task 1:** typed slots, content separate from code, recoverable swaps, pristine/override states, last-good preview, quality gates, accessible defaults.
- **From Perspective B / Task 2:** readable file format, closed composition grammar, Grammar Guard, minimal-diff writes, versioned five-contract protocol, inspect/provenance, local-folder adapter.
- **From Task 3:** quality guarantees expressed as tests and controlled release states, not claims of flawlessness.
- **From the Hybrid draft:** H1–H21 and R01–R33, section/layout separation, v1 counts and URL, 24 invariants, 30 errors, phased evidence gates.
- **Corrections:** Supabase-only business backend/auth/data supersedes the hybrid's GitHub-only/default and optional-database paths; source-derived vs published code trust boundaries are stronger; v1 CLI and history branches remain excluded; operational portability is separate from live-host continuity.

### 1.2 What v1 means [D/C]

**User-visible:** five curated complete portfolio template presets (growable to ten), eight section layouts L1–L8 plus blank page, header/footer choices, approximately 16 component implementations with ~35 **parameterized variants** as the *planning catalogue* (do not pretend they exist). Editing is one interface with progressive disclosure—content by default, visual composition when requested, supported source and user code under Advanced. The editor has responsive views, assets, linear snapshots, restore and compare, private staging, a publish preflight, immutable releases, rollback, portable project/static export, and a local-folder adapter on capable browsers. A public release is intended at `https://kadmeion.vercel.app/<username>/<portfolio-url>` **if the host name is available, terms allow it, and SP1/SP2/SP5 prove delivery**.

**Hard v1 exclusions:** no command-line app; no branches/variants (Duplicate Portfolio only); no real-time multiuser collaboration; no public marketplace; no automatic arbitrary-HTML/JS reverse engineering; no mandatory GitHub ownership or repo; no arbitrary npm/server code; no auto-paid upgrade; no production release of untrusted user JavaScript unless isolation has independently passed. Cloud free-tier failure **must not prevent the local editor/demo and exported static content from running**; it cannot be promised that a provider-owned live URL continues working after its provider disappears.

**Critical distinction:** an incomplete draft is allowed and saved, including required-but-empty slots and temporarily invalid text buffers. Only a **committable structured revision** must satisfy the *structural* schema; publishing has stricter completeness, security, accessibility and deployment gates. This resolves the source contradiction “no invalid page can be saved” vs “deleting a required component leaves an empty slot.”

### 1.3 The nonnegotiable flow [D/C]

`choose template or Blank → author content/images → optionally rearrange compatible components → optionally create/edit custom code → preview the exact selected revision → save/recover → validate and stage → publish snapshot → inspect the public URL → rollback/export`.

At every stage: **never silently delete words, assets, custom source, or history; never auto-execute imported user code with app privileges; never imply a publish/sync completed until the authoritative storage confirmed it.**

## 2. Authority, decisions, comparisons and contradictions

### 2.1 Authority order

1. [D] Latest direct owner instructions in this prompt: hybrid, MIT, no CLI, linear snapshots, folder adapter, modern-browser tiers, URL shape, limits, broad editor scope and flexible timeline.
2. [D] Later Kadmeion platform choices already established: Kadmeion name/approved visual identity; **Supabase Auth (ordinary email; optional Google), PostgreSQL/RLS, Storage and Supabase backend logic; no MongoDB/Mongoose/Express final backend**; public portfolios do not require GitHub; original approved K, Aether Drift C, dark theme, approved pattern and real glyph-shaped skeleton loaders. These override a research draft's GitHub-only sign-in and optional database. Integration with actual code has not occurred.
3. [D] Documented original editor decisions D06, D11, D17/D21 superseded by D82/D90, D35, D38–D47, D67, D72–D75, D81, D86–D90, to the extent their exact normalized summaries are available. User-provided missing feature-table rows remain separately open.
4. [C] H2–H4, H8, H12–H21 design defaults, except items corrected here with explicit reasons and crosswalk.
5. [S/A] Any library, hosting, browser, storage or security behavior not demonstrated in Kadmeion; precedents are not integration proof.

### 2.2 Boons-and-banes synthesis

| Perspective | Strongest boon | Principal bane | Final disposition |
|---|---|---|---|
| Task 1: document-first | Understandable one-source-of-truth; predictable delete/drop and generated code | Locked source can feel inauthentic; generated code alone is not owned project structure | **Merge** safety and typed content into files-based storage |
| Task 2: project-first | Intent operations, readable files, closed language, SDK contracts and technical trust | Parser/printer/source maps and git-like extensions can consume a student's entire project | **Merge** small grammar and operations; **drop v1 CLI and branches** |
| Task 3: target-state reference | Ten explicit guarantees, reviewable flows, one renderer and measurable acceptance | Some guarantees are absolute; shared custom React rendering/security assumptions need proof | **Adopt as target** but qualify residual risks and custom-code parity |
| Spec A: document-first | State machine, stash, override ownership, 13 invariants, E01–E18, spikes S1–S7 | Its illustrative Document and three-first-layout default diverge from later hybrid counts/files | **Merge** semantics; keep hybrid v1 catalogue and files |
| Perspective B: files-first | JSONC, Grammar Guard, five contracts, provenance, external edits, developer scorecard, SB1–SB7 | Minimally edited JSONC comments are not automatically safe; shell/SDK expansion too broad | **Merge guarded files**; gate losslessness; defer CLI/variants/community |
| Hybrid H1–H21 | Captures owner-level decisions, public path, 24 invariants, 30 errors, 8 layouts/5 presets and browser tiers | Incorrect older GitHub/auth assumption; optimistic HTML-serving path; some misleading guarantees and cut rules | **Adopt structure with documented replacements**, not wholesale |

### 2.3 Decisive contradictions and resolutions

| Conflict | Alternatives in sources | Final choice / reason |
|---|---|---|
| Truth | Hidden JSON vs external files vs arbitrary code | Files persist; a validated parsed graph is the view; arbitrary code is opaque. No twin truths |
| Code appearing on drop | Copy implementation into slot vs generated usage vs per-slot source group | Default *component usage* + read-only implementation inspection; Customize/Detach creates an explicit full user-owned copy. No invisible pasted text surgery |
| Two-way editing | Locked generated output vs arbitrary code round-trip | **Closed JSONC composition/content/tokens** only; user-owned source is never reverse-engineered or auto-patched |
| Slot state | Spec A S0=empty vs Hybrid S0=pristine | Canonical **EMPTY, S0 (pristine), S1 (override equal to base), S2 (modified override)**. Old Spec A S0 maps to EMPTY, S1 maps to S0, S2 maps to S2 |
| “Valid” | Empty required title is invalid vs delete can empty slot | Structural draft validity ≠ publish readiness; use separate validators |
| History | Git branches vs linear snapshots | Linear, append-only within retention policy; duplicate portfolio instead of branches |
| Stack/auth | Hybrid GitHub login, database-or-none vs user's later Supabase-only decision | Supabase email/optional Google, PostgreSQL RLS/Storage/Edge Functions; GitHub may be **optional integration**, never a sign-up gate |
| Public architecture | “Static host serves anything” vs Vercel Blob/Edge limits | Versioned releases + independent delivery adapter. **Vercel Blob cannot directly host HTML** [V]; route-handler/proxy/static deployment must pass SP5 before calling target URL viable |
| Backendless public pages | “Independent of DB” vs pointer stored in same DB | Put public release/pointer serving in an independently available release-delivery store; verify via DB-off test; a single cloud outage may still take it down |
| Local first | Browser storage = permanent vs browser eviction | Best-effort only; require export, recoverability, cloud optional, folder mode where available, explicit storage-status labels |
| All browsers | Identical code/folder features vs limited APIs | Modern engines receive core editing; folder picker capability-gated; mobile source fallback; legacy visitors may see static HTML only |
| Custom code | CSS scoping/Shadow DOM mistaken for security | Opaque code executed only in isolated origin/runtime with explicit capabilities, or not executed/published at all |
| Universal “every action undoable” | Reverse all operations including deletion/provider effects | Local authoring operations restorable while history exists; irreversible published/external side effects identified before confirmation |
| Anonymous/unlisted | “noindex” equals privacy | Only private is access-controlled; **unlisted is link-accessible**, noindex only an indexing request; reviewer links require real server/edge expiry and revocation |
| File budget | Large monorepo and optional packages vs ≤200 source/config files | Use compact modules and a file-count ledger; user exports/assets not counted; increase requires separate agreement |

### 2.4 Decisions register and boons/banes

**H1–H21 remain stable** as the hybrid's historical identifiers. Appendix B maps each H row to an adopted, merged, replaced or dropped implementation, with its boon, accepted bane, evidence and constraint effect. New clarifications use **C01–C24** rather than renumbering the H register.

| ID | Decision | Benefit | Accepted downside; evidence |
|---|---|---|---|
| C01 | Canonical committed file-set + parsed graph, one write path | Safety and readable projects | Transaction engine and explicit recovery work [C] |
| C02 | JSONC for managed composition/content/tokens **only if lossless patch spike SB1 succeeds**; otherwise machine-managed plain JSON with lossless import/export of original user files | Developer readability without silent comment movement | Formatting edge cases; prefer reject/sidecar over destructive patch [C/S] |
| C03 | Preserve comments, unknown keys and untouched source bytes unless an exact edit is provably safe | No silent modification | Some edits must be blocked pending repair [C] |
| C04 | View mode is one workbench: Content → Visual → Source → Blank, not four independent products | Beginner clarity | More careful access gating [C] |
| C05 | Component references by default; implement Customize/Detach explicitly | Small, maintainable code; still user-owned custom escape hatch | Detached components lose automatic library upgrades [C] |
| C06 | A required empty slot can be saved but blocks publication | Supports exact delete/drop journey | Publish readiness distinct from structural validity [C] |
| C07 | One committed writer per project; optimistic revision check and conflict-copy fallback | Avoids lost updates | Real-time collaboration excluded [C] |
| C08 | Custom source text buffers may be invalid; never overwrite last-good committed source and never mark an unsaved buffer “saved” | Safe authoring | Status UI more complex [C] |
| C09 | Generated preview and production share input/renderer/compiler versions; parity is *tested*, not guaranteed for custom scripts without evidence | Lower surprises | Build/environment differences remain [C/S] |
| C10 | Custom code is untrusted **during build, preview and publication**; no raw React execution with app privileges | Security | May delay interactive custom features [C/S] |
| C11 | No publish of custom client JS until SP1 proves sandbox and direct-open behavior; static-only fallback if it fails | Protects visitors | Some JS capabilities deferred [C/S] |
| C12 | Static release independent of Supabase DB **only with proven independent release service** | Public resilience | Separate delivery/storage operations and free-tier uncertainty [C/S] |
| C13 | Preserve owner's URL pattern; dynamic HTML delivery is provisional until SP5/host permission tests | Stable public link objective | Provider feasibility risk [D/S] |
| C14 | Supabase-only application backend and PostgreSQL; delivery bridge may proxy already-built static bytes but cannot become an Express/MongoDB business API | Honors later owner choice | Host function for serving may still be needed [D/C] |
| C15 | No CLI in v1; core stays headless and testable using npm/CI test runners | Less scope | No user-facing `kad` commands yet [D/C] |
| C16 | Linear revisions + named checkpoints + publish tags; deletion overrides normal preservation | Reliable undo while respecting 15-day Trash policy | Bounded history/backup lifecycle [D/C] |
| C17 | Folder adapter in v1 for capable desktop browsers; ZIP on others; cannot silently drop mandatory feature when spike fails | Honors D and avoids browser fiction | May gate release or need narrower supported folder behavior [D/S] |
| C18 | No variants in v1; Duplicate Portfolio duplicates current snapshot to a new linear history | Less merge complexity | More storage, no semantic branch merges [D/C] |
| C19 | Authentication is email with optional Google, not GitHub-based | Removes GitHub onboarding gate | Email delivery/rate-limit configuration requires proof [D/S] |
| C20 | Manual/private/non-GitHub projects supported; unverified claims labeled | Honest developer evidence | No blanket ownership badge [D] |
| C21 | Published visuals use approved Kadmeion identity only in the editor; users control their exported portfolio themes | Product coherence without forced branding | Template/theme licensing and contrast work [D/C] |
| C22 | Editor itself and released pages target WCAG 2.2 AA; realistic, tested device/keyboard behavior | Inclusive experience | Human review required [D/C] |
| C23 | No unsupported claim of universal zero bugs, zero external requests, immediate cache deletion or continuous live availability | Defensible requirements | Less marketing-sounding guarantees [C] |
| C24 | V1 includes offline demo rehearsal, exported project/static site and provider-loss playbook | Survive free-tier loss *for demonstration and ownership* | Not continuous online availability [D/C] |

## 3. Requirements and acceptance traceability

**Authoritative numbered editor requirements:** R01–R33 from Hybrid §3. Their exact IDs and original provenance remain in Appendix C; the final controls and tests below cover them without changing their numbers. R34–R47 are **architect additions**, not invented owner decisions.

| Requirement group | IDs | Final mechanism | Minimum acceptance evidence |
|---|---|---|---|
| Templates and authoring | R01 R02 R12 R17 R20 | Presets, slots, tokens, source projection | Unassisted template fill and publish; no accidental style corruption |
| Reusable components | R03 R13 | Manifest + versioned components; My Components | Component created, reused in two portfolios, compatible slots enforced |
| Advanced code and sync | R04 R05 R09 R14 R15 R16 | Closed composition grammar; opaque user files; delete/drop/undo states | Invalid source recovery, exact custom-file byte preservation, mismatch guidance |
| Responsive and imagery | R06 R18 | Per-breakpoint layout, typed content references | Multiple widths; image changes touch content/asset metadata only |
| Preview, publish, history | R07 R08 R22 | Revision-based preview, staging, gates, independent static release, rollback | DB-down public test, rollback parity, reviewer expiry test |
| Delegated/editor UX | R11 R19 R21 R23 R24 R25 R26 R27 | Progressive workbench, free local compiler, quality evidence, review script | Usability study and tech-lead walkthrough |
| Governance and owner constraints | R10 R28 R29 R30 R31 R32 R33 | Explicit status, linear history, browser tiers, path URL, cost and export | Audit manifest, offline demo and no-cost ledger |

**New architect-added completeness requirements:**

| ID | Requirement [C] | Verification |
|---|---|---|
| R34 | Supabase email auth + optional Google, no mandatory GitHub; auth type still unspecified | Account creation/reset/session checks in permitted auth PoC |
| R35 | Supabase PostgreSQL/RLS, Storage and Edge Functions, no MongoDB/Express final runtime | RLS adversarial matrix, cost/free tier review |
| R36 | Public serving not tied to active Supabase database (when independent delivery is configured) | Stop/disable DB in isolated test and fetch release |
| R37 | Published route, direct assets, redirects, private/unlisted, 404/tombstone and cache invalidation have explicit access tests | HTTP/browser route and crawler matrix |
| R38 | Offline deterministic browser demo without cloud and complete project/static export | Disable network and launch local demo/export |
| R39 | Multiple tabs/devices never silently overwrite; conflict copies | Two-tab and two-device fault injection |
| R40 | One trust model for compile, custom code, imports, preview and published view | Security lab: same-origin, CSP, postMessage and direct URL attacks |
| R41 | Editor keyboard, screen reader, touch and reduced-motion behavior validated | Keyboard-only and real-device checks |
| R42 | Backup/Trash obeys immediate public unpublish, 15-day recoverable primary data then final deletion and disclosed backup retention | Lifecycle clock tests and operator policy |
| R43 | Data/asset licences, user rights, terms/privacy/abuse escalation and host eligibility separately reviewed | Signed release checklist (not legal advice) |
| R44 | Public discoverability, social cards, metadata and link behavior work without client JS | Fetch page source/crawler/Open Graph tests |
| R45 | Offline export excludes secrets/privileged tokens; import rejects zip bombs and traversal | Hostile input tests |
| R46 | Each vendor limit and browser feature has evidence date; unverified deployment steps are spike-gated | Evidence register updated at decision gate |
| R47 | One source-file and generated-export retention/owner access policy reconciles version history with deletion | Recovery and erasure matrix |

### 3.1 Known source gaps (do not fabricate)

- **G1 [D]:** Pasted D01–D90 feature-table rows **1, 2, 9, 10, 11 and 12** were absent/truncated. Their original table wording is unknown here; they are **not reconstructed** from the separate normalized decision register. Traceability is pending receipt of the actual table, without blocking an editor-only blueprint.
- **G2 [D]:** Other feature rows outside the visible summary are not necessarily represented by the hybrid. No “full application scope” certification is claimed.
- **G3 [A]:** Actual L1–L5 image pixels not attached in this turn. Slot mapping below follows the documented readings only; visual fidelity requires image review when available.
- **G4–G13:** Original Hybrid §32 ambiguities (layout/template counts, whole-page vs section, E1 answer lettering, UX-law definitions, free compiler versus offline, visitors, multi-page scope, anonymous editing, rest-of-product import) retain their IDs in Appendix H and are resolved or marked open there.

## 4. Technical architecture: one source, one write path

```text
BROWSER WORKBENCH (progressive disclosure; no mode conversions)
 ├─ template chooser / structured content / assets / theme
 ├─ section-list + slot-aware canvas / properties / problems
 ├─ composition editor and opaque custom-code editor (Advanced)
 └─ revision, compare, preview, publish UI
              │ typed operations carrying base revision
              ▼
HEADLESS TYPESCRIPT CORE (no UI/network imports)
 ├─ Project Format + Component Protocol + Operation Contract
 ├─ JSONC parser/Grammar Guard + project graph + version resolution
 ├─ preconditions → plan patch → dry run → validate → commit
 ├─ content mapping/stash/unplaced tray + history + deterministic assembly
 └─ Build Contract / Release Contract / preflight diagnostics
       │                  │                   │
       ▼                  ▼                   ▼
STORAGE ADAPTERS    PREVIEW/COMPILER       TRUSTED PUBLISH ADAPTER
 IndexedDB           isolated worker/frame  Supabase Auth/DB/Storage
 Folder (supported)   last-known-good         for owner workflows
 Zip import/export    untrusted JS confined   independent static release
 optional Supabase                             delivery for public URL

ONE COMMITTED PROJECT REVISION → SAME LOCKED INPUTS → PREVIEW + STATIC RELEASE
```

### 4.1 Five versioned contracts [C]

| Contract | Content | Conformance |
|---|---|---|
| **Project Format** | Folder, JSONC/JSON schemas, stable section+slot IDs, storage semantics, migration | Valid/invalid corpus, round trip and old-project test |
| **Component Protocol** | `id@version`, `fits[]`, fields/aliases, props, dependencies, capabilities, a11y, hydration, samples | All library and user component fixtures |
| **Operation Contract** | Intent, base revision, preconditions, touched paths, inverse/recovery metadata, error code | Golden patches, property tests, stale revision tests |
| **Build Contract** | Lockfile, compiler toolchain version, asset processing, HTML/CSS/script outputs, hashes and gate report | Repeat build/parity where environment controlled |
| **Release Contract** | Snapshot binding, immutable files, pointer/access policy, rollback, revocation, verification and audit | Fault injection at each publish state |

**Ports/adapters:** a pure core can be used in the browser and by test automation. It does not need a public CLI in v1. Concrete adapter names, data stores and UI libraries must not leak into format semantics. Auth and static delivery services are infrastructure, not an alternative project editor.

### 4.2 One complete edit transaction [C]

1. UI/Advanced file view submits `Operation{opId, projectId, baseRevision, intent, target, payload}`; direct source typing is *buffered until parseable*, not committed character-by-character.
2. Resolve the current saved revision and file hashes; stale/conflicting operations cannot overwrite blindly.
3. Check owner/storage permissions, format version, Grammar Guard states, component and slot contracts, quota and requested capability.
4. Plan minimally scoped edits to editor-managed files. Never add implicit patches to opaque user code.
5. Dry-run entire multi-file operation in memory; reparse changed files and validate cross-references; classify “safe draft” separately from “publish-ready.”
6. For risky changes (S2 custom override, change layout/template, restore, component upgrade), show concrete affected content/files and request explicit confirmation.
7. Write recoverable before-images/transaction journal; commit all changed files atomically in IndexedDB or best-effort journaled/recovery-safe in local folders; record one new linear revision and inverse intent.
8. Send committed revision to all lenses. Render from that exact revision and display truthful local/folder/cloud save state.
9. On any failure **before durable commit**, leave the prior committed revision intact and keep the uncommitted user's text in a recoverable draft buffer; emit a precise error with next action.

**Transaction invariants:** no partial publish; no stale patch blindly applied; no “Saved” until the selected authoritative adapter acknowledges it; no after-the-fact repair of user code. The folder adapter cannot promise native multi-file atomicity, only recoverability under the tested crash/permission matrix [S: SB6].

### 4.3 Responsibility boundaries

- **Core:** pure parsing, schema, operations, assemblers, validators, diff, deterministic output mapping.
- **Editor UI:** accessible interaction and state visualization; never writes files directly.
- **Runtime/compiler:** compile trusted library and custom code only in appropriate isolated contexts; no privileged tokens.
- **Supabase:** email/Google Auth, Postgres owner records and revisions, RLS, private assets, trusted transactional API/Edge Functions, quotas.
- **Delivery adapter:** already-built versioned static bytes, route selection, privacy rules and cache controls; may need a thin Vercel frontend route handler under a host-specific implementation. It must **not** turn into Mongo/Express or a parallel application business backend.
- **Release store:** immutable release bytes plus mutable visibility/release pointer, not dependent on a paused Supabase database if R36 is to pass.

## 5. Precise slot model and swap mechanism

### 5.1 Formal model [C]

`Portfolio → ordered Sections → pinned Layout → named Slot(address) → Assignment(component@version | custom component | EMPTY) → Props + user Content + responsive Overrides`. A header and footer are separate layout roles; five wireframes are treated as **section layouts**, not complete one-screen sites. The section ID remains stable after reordering. A slot address is `<section-id>.<slot-id>`; header/footer names are reserved and noncolliding (e.g. `header.logo`, `footer.links`)—this corrects the hybrid's ambiguous bare header keys.

Slot manifest: `id`, `type`/accepted components, `min/max`, `requiredForPublish`, content schema, sample and defaults, responsive bounds, focus/aria semantics. A component's manifest is **data**: its claims are checked, not trusted as permissions; untrusted authored code remains sandboxed even when it claims `capabilities: []`.

### 5.2 Canonical slot states [C]

| State | Meaning | Visual | Code panel | Allowed action |
|---|---|---|---|---|
| `EMPTY` | No assignment | Dashed target + accepted block types | Empty code reference, no phantom JS | Add, restore, keep draft; publish blocked if required |
| `S0` | Library block, pristine | Normal preview | Usage line + read-only implementation view | Edit content, swap, Customize |
| `S1` | User-owned override exists but is byte-identical to pinned base | Normal preview, Custom badge | User-owned file | Edit code, revert, swap with confirmation if file ownership affected |
| `S2` | User-owned override differs from base | Preview or last-good state | User-owned code + diff | Replace only after Keep / Replace-and-stash / Cancel |
| `ERROR` (orthogonal) | Compile/runtime issue | Slot-local error or last-good preview | Diagnostic at file/line | Fix, revert, restore; cannot publish erroneous code |

Task 3's `Synced`, `Updating`, `Invalid draft`, `Blocked` are **document/preview health statuses**, not replacements for `EMPTY/S0/S1/S2` component ownership state. Grammar Guard `VALID`, `INVALID-*`, `CHANGED-UNDER-US`, `UNKNOWN-KEYS` is a **file status**. This prevents the original documents' same-word/different-state collisions.

### 5.3 Delete, drop, swap and content mapping [D/C]

| Action | Atomic structural effect | Non-lossy content/code effect | User-visible feedback |
|---|---|---|---|
| Delete `hero.title` | Assignment becomes EMPTY in a valid draft | Outgoing component, content fields, asset refs and override copied to stash/history; nothing deleted from recoverability scope | Canvas shows compatible drop target, code panel shows empty slot; Undo |
| Drag Heading B onto empty title | `AddComponent` validates fit, version, capacity | Restore matching content by key and declared aliases; unmatched values remain in Unplaced tray | Usage source appears for Heading B in code; “Your title was kept” |
| Drag Heading B onto filled pristine title | `SwapComponent` as one transaction | Stash outgoing version; map matching *typed* fields; no lossy string→media guess | One undoable change, one diff/snapshot |
| Drag over S1/S2 authored file | Refuse before confirmation | Keep as reusable custom component / Replace with protected stash / Cancel | Explicit file impact report and confirmation token |
| Drop incompatible block | No committed change | Existing state untouched | Explain accepted slot types and offer compatible items |
| Change section layout | Produce typed slot-to-slot mapping preview | Preserve all unmatched/oversize values in Unplaced; don't truncate | Diff of moved/stashed content, confirm and Undo |
| Replace image | Update content asset reference/alt/focal metadata only | No component implementation change; old asset stays while revisions reference it | Preview refresh, alt warning when needed |

**Mapping rules:** same field name+type first; alias mapping only if declared and unambiguous; media references by asset ID, not untrusted remote executable URLs; new required fields shown as labeled sample placeholders (not invented real content); never silently truncate long text; preserve previous content until retention expiry; never auto-dereference files during a swap.

### 5.4 Code mapping: what really appears

When `hero.title` becomes EMPTY, its **generated usage** disappears and the code view shows an empty slot marker (not a real blank user-code file whose edits could be lost). When Title Stacked is assigned, the usage source updates to reference `TitleStacked@pinned-version`; the library implementation remains one vetted shared module. **Show implementation** reveals read-only React source; **Customize** creates a separate user-owned source file, intentionally disconnecting it from automatic upgrades. Generated regions are never text-surgically overwritten. This preserves the owner's visual behavior without the failure mode the first two perspectives warned against.

**Worked structural example (illustrative, not executed):**

```jsonc
// pages/home.page.jsonc — editor-owned structured composition
{ "sections": [ { "id":"hero", "layout":"arc-hero@1", "slots": {
  "title": { "use":"title-stacked@1", "props": { "size":"xl" } },
  "cta1": null
} } ] }
```

Changing the `title` assignment affects that JSONC entry, pin/lock metadata and one revision; it does not rewrite `content/home.content.jsonc` when field contracts are compatible. `CustomTitle.tsx`, if present, is explicitly user-owned: structural operations preserve it byte-for-byte in stash/history and never pretend to parse it back into a visual tree.

### 5.5 Sync impossible: precise manual help [D]

The engine must distinguish **incompatible slot**, **invalid JSONC**, **unsupported custom code**, **ambiguous content mapping**, **custom override replacement**, **dependency/capability rejection**, **external file conflict**, and **publishing isolation failure**. Every refusal shows affected slot/file, why the change is unsafe, an editable path (`Choose compatible component`, `Open content field`, `Fix line`, `Detach`, `Compare versions`, `Save as custom`, `Keep both`, `Export`) and Undo/Cancel when applicable. **Never tell a user to “just edit the code” without identifying the owned file and preserving the current draft.**

## 6. Project files, grammar, operations and versioning

### 6.1 Human-readable project format [C/S]

```text
portfolio/
├── kadmeion.json                  # project manifest: format version, owner-neutral identity, library pins
├── kadmeion.lock.json             # generated exact manifest/component/dependency hashes
├── pages/home.page.jsonc          # header + ordered section layouts + typed slot assignments
├── content/home.content.jsonc     # text, links, image asset IDs, alt and content provenance
├── theme/tokens.jsonc             # fonts/colors/spacing/motion/breakpoint-compatible choices
├── slots/<section.slot>/Title.tsx  # OPTIONAL custom per-slot code: never auto-rewritten
├── components/<custom-id>/         # custom implementation + declarative manifest
├── assets/<sha256>.<ext>           # user images; associated verified metadata and rights declaration
└── .kadmeion/                      # local journal, stash, linear revisions, recovery settings
```

**Portable archive policy:** public project export includes files necessary to reopen and build, selected named restore points when requested, but **not** Supabase credentials, private refresh tokens, session cookies, undocumented admin data or local secret files. The portable static-site zip contains only built public output. `.kadmeion` history may be optionally included in a private backup archive; it is never published or shipped to public visitors. Exports are tested after disconnection.

**Managed vs opaque ownership:** `kadmeion.json`, composition/content/tokens/manifest and lock metadata are managed only through guarded operations; `slots/*/*.tsx|css|js` and user `components/*` implementation files are writable only by intentional source text edits or explicit copy/restore actions. System may read/compile them only in approved restricted environment; source files are *opaque* to visual editing. An unrecognized import remains preserved but non-publishable until a supported adapter or safe static fallback exists.

### 6.2 File format and Grammar Guard [C]

- Fixed files use the **small known grammar** JSONC+published JSON Schemas; no arbitrary expressions/imports in composition. Every section and assigned component has stable IDs/version pins. Comments and unknown fields must be retained; an unknown security-sensitive key is a warning/possible gate blocker, never silently executed.
- Statuses: **VALID**, **INVALID-SYNTAX**, **INVALID-SCHEMA**, **INVALID-REFERENCE**, **CHANGED-UNDER-US**, **UNKNOWN-KEYS** (warning class). A file may be parseable but not publish-ready; the Problems panel identifies both.
- A syntax/schema error in an externally edited file means **do not write to it**. Maintain last valid preview plus a local recovery copy; allow the user to repair, compare or restore explicitly.
- On external edits compare content hash and base revision. Re-plan intent against new bytes only if unambiguous. Otherwise create conflict copy and require choice. Do not resolve unrelated changes by overwriting their source text.
- **Formatting caveat:** [V] `jsonc-parser` exposes AST position, `modify` and `applyEdits`; [V] a 2026 issue documents trailing-inline-comment misassociation on some insertions. Therefore minimal-diff/comment preservation **cannot** be guaranteed by package selection alone. **SB1 must demonstrate** preservation across a golden corpus, or v1 selects plain JSON for machine-managed files and/or refuses ambiguous patches while retaining original imported files. A wholly new custom JSONC printer is *not* the default student's task.

### 6.3 File changes and crash recovery

- IndexedDB: write changed paths, new content hashes, operation reason and new head reference in a single transaction where feasible; record a durable precommit draft buffer before risky operations.
- Folder adapter: maintain a recovery journal/before-images in a safe local store and folder when permitted; compare fingerprints just before each write; recover or quarantine partial writes on restart, especially if user revokes permissions. Do not promise filesystem transaction semantics the API lacks.
- Autosave distinguishes **Edited locally**, **Saved in browser**, **Saved to folder**, **Synced to cloud**; never display one “Saved” badge that implies all four.
- Two tabs: navigator.locks/BroadcastChannel where supported, fallback base-revision conflict detection; one active writer per project instance, external edits detected at focus/read/write. Two devices: linear head CAS, otherwise preserve both as separate copies.

### 6.4 Source-code workbench and compiler [C/S]

- Source panel grouped by slot; generated composition/usage and trusted library implementation shown **read-only**; user custom `*.tsx/*.css/*.js` editable by intention. Advanced file view shows closed-grammar files with syntax/contract diagnostics, autocomplete and project provenance.
- Monaco is a desktop candidate for source, diagnostics and multi-file models [V: MIT; S7 actual integration]. **Monaco's own repository says it does not support mobile browsers [V]**: mobile uses a simpler accessible plain-text editor with limited source functionality or read-only source, while content/tap-to-place/preview/restore/publish remain tested. Do not claim full Monaco parity on phone.
- `esbuild-wasm` can transform in the browser [V], but reliable multi-file TypeScript/React resolution, bundling, transforms, source maps and CSP-safe execution still need S2. Never give arbitrary untrusted code host DOM, Supabase tokens or ambient network privileges.
- For overridden code, a compilation error preserves raw source buffer, last good committed custom source, and last-good preview per slot; a hung runtime terminates its sandbox/worker where possible. Last-good must be visibly labeled stale so users do not mistake it for current output.
- User code may be parsed for **diagnostics/compilation** inside the isolated compiler, but it is not parsed for automatic visual reconstruction.

### 6.5 Versioning, migration and linear snapshots [D/C]

- Each commit stores a parent revision, canonical file-hash map, intent reason, timestamps outside deterministic build bytes, and optional restore-point name. Rapid typing coalesces into manageable transactions; no branch/variant DAG in v1.
- Undo of a committed editor action is **a new inverse operation/revision**, not deletion of an old snapshot. Restore is also a new revision copying the old file-hash map. Preview/render/publish always pin a revision ID.
- Layout, component, theme and project format versions are pinned, migration previews show affected files, missing versions cannot be silently upgraded. Every old sample project runs through migration compatibility tests.
- Retention is **not infinite**: draft Trash 15 days after deletion, then primary data and public snapshots removed; backup expiry must be set/disclosed. Normal history pruning requires warnings and preserves named restore points until user deletion/retention policy says otherwise. Never promise perpetual recovery on a free tier.

## 7. Layouts, templates, component protocol, assets and themes

### 7.1 Correct unit definitions [C]

- **Layout:** reusable one-section arrangement with named typed slots; decoration (arcs/grid/stepped shapes) belongs to layout code, not drag/drop content.
- **Component:** reusable code-backed block with typed props/content, accessibility and responsive contract; variants come from props, not 35 unrelated source files.
- **Template preset:** a fully assembled one-page portfolio combining header, multiple section layouts, footer, theme and clearly labeled sample content. Five presets in v1, additional up to ten as budget permits.
- **Blank Custom:** a project with no sections and an optional header/footer; can start by adding existing layouts or create a custom layout/component through bounded contract tools. Does not promise arbitrary raw-site import.

### 7.2 v1 layout catalogue [C]

| ID | Section layout | Slot intent | Availability sequence |
|---|---|---|---|
| L1 | Arc Hero | `title`, `text`, `cta1`, optional `cta2`, `note`; layout-owned arc | First vertical slice |
| L2 | Collage Hero | intro title/avatar/text/buttons, media images, project highlight | After L1/L4/L3 |
| L3 | Project Showcase | gallery/media/image/badge/title/meta/cta | Third |
| L4 | Editorial Bento | title/media/text/image/card/cta | Second |
| L5 | Stepped Hero | title/subtitle/cta with stepped decor | Fifth |
| L6 | Skills | title, repeatable skill items, note | Supporting portfolio section |
| L7 | Experience | title, repeatable role/education items | Supporting portfolio section |
| L8 | Contact | title, text, links and CTA; no unsafe public form | Supporting portfolio section |

Header variants: pill, CTA, full, menu; footer variants: simple/minimal. Each layout defines responsive named areas, accessible DOM reading order, min/max content, required-for-publication slots, token usage and reduced-motion behavior. L2/L5 irregular masks are *decorative CSS/SVG*, not an excuse to modify the underlying uploaded image or hide content on mobile.

**Presets [C]:** Arc, Collage, Editorial, Stairs, Studio; each consists of selected section layouts and distinct meaningful developer/project storytelling. Marketing/sales labels like price or product should be translated into portfolio-relevant `meta` (technology/year/metric) and `project` fields—not irrelevant e-commerce UI.

### 7.3 Component and slot contract [C]

Slot types carried from Hybrid §10.6: `brand`, `nav`, `icon`, `heading`, `text`, `cta`, `media`, `image`, `gallery`, `card`, `badge`, `meta`, `project`, `avatar`; *decor* is not a slot. Component categories/variants carried from Hybrid §13: mark; navigation; icons/social links; title variations; text variations; CTA variations; video/embed/frame; images; gallery; cards; badges; metrics; project cards/features/cases; avatar shapes. **V1 code-count target:** approximately 16 implementations/35 property variants [A; validated by file budget and UX tests].

Manifest fields: `protocol`, `id`, `version`, `fits`, typed `content` keys + aliases, props defaults/limits, `slots` for nested blocks, permitted dependencies, tokens, `capabilities`, hydration trigger, a11y semantics, responsive rules, sample minimum/maximum content, size budget, docs, deprecation stability, integrity hash. All curated library components use this same publicly documented protocol as locally authored custom components, though code trust levels differ.

**Component conformance:** schema validity → sample render at stress content → responsive at tested widths → reduced-motion → keyboard/axe/manual a11y → dependency/license check → global CSS isolation → deterministic render where feasible → declared-capability vs actual-execution test. New component authors must be able to follow docs without an undocumented internal shortcut. The HTML semantics are more important than trendy motion.

### 7.4 Content, media and theme [C]

- Content fields are structured values, stored apart from component code. User-authored claims are never silently relabeled as verified GitHub accomplishments.
- Image slot uses asset ID, alt/decoration flag, focal coordinates, crop/shape enum and optional caption; replacing an image updates content/metadata only. Validate MIME/magic bytes, dimensions, decompression sizes, EXIF stripping, optimization, srcset and SVG rasterization/sanitization in isolated processing. Unsupported media stays recoverable and nonpublishable if unsafe.
- Default allowlisted video/embed providers only if data/privacy policy and safe `frame-src` are tested; no mandatory autoplay. Contacts use links/mailto instead of untrusted public forms for v1.
- All typography, color roles, spacing, radii, motion and responsive choices flow through versioned theme tokens. The Kadmeion **editor chrome** uses the owner's original K, Aether Drift C, selected pattern, approved dark mode, brand typography and real glyph-shaped skeleton loading states. The builder must not forcibly apply Kadmeion branding to **users' published portfolios**; their identity/tokens are separate. Sample images/mock project metrics remain illustrative, explicitly labeled, never published as fake evidence.
- UX laws are not magic numbers: visible focus, keyboard, contrast, readable text, responsive semantics and reduced motion are enforceable; aesthetic heuristics (e.g. “no more than seven navigation items”) are warnings/design review, not universal hard accessibility gates.

## 8. Preview, sandbox, isolation and build parity

### 8.1 Shared build contract [C/S]

`pinned committed revision → parse/resolve → trusted library + bounded custom assets → compile (if needed) → safe static HTML/CSS + allowlisted trusted hydration → metadata/asset variants → hash manifest → preflight → immutable release`. Canvas/preview uses the same pinned layout/runtime inputs and a renderer designed for the same semantics. **Production and preview can differ because instrumentation, CSP, network context, storage host and browser rendering differ**; verified equivalence is an acceptance criterion, never an untested assertion.

**Custom-code parity caveat:** when custom JS is disabled for public release, a preview of JS interaction is *not* the public output. The editor must display an explicit “Public release will be static here” preview mode and require acceptance; better still separate **Preview as author** vs **Preview as published** and use the latter for publish gates.

### 8.2 Threat boundaries [C/S]

| Surface | Trust level | Conditions |
|---|---|---|
| Editor app / auth pages | Privileged | Supabase credentials never exposed in custom sandbox; no user-sourced executable HTML |
| Vetted library | Reviewed but update-sensitive | Pinned, audit-controlled, restricted capabilities and styles |
| Imported project/assets | Untrusted | Parse structurally without execution; sanitize/virus-type checks as feasible |
| User source (TSX/JS/CSS) | Untrusted | Compile/transform and run in isolate; no ambient network, storage, parent DOM, auth cookies or privileged bridge |
| Static release renderer | Trusted | Must consume sanitized data and trusted components; no executing arbitrary user React on privileged server/edge |
| Interactive island, if ever permitted | Untrusted | Separate origin (ideally separate site), `iframe sandbox`, response CSP sandbox, no same-origin capability, strict `postMessage` channel, limits and direct-open test |
| Public page | Public trusted static content | CSP, text escaping, verified hash allowlist; private/unlisted access enforced at delivery |

**Important:** Shadow DOM and CSS containment are styling/DOM encapsulation tools, *not* security isolation. An iframe alone does not protect a script when it is opened as a top-level URL: response CSP, host separation and direct-URL testing are needed. `sandbox="allow-scripts"` must not be combined with a same-origin weakening path that lets user code escape. Message handlers validate `event.source`, nonce/capability and expected message schema; do not blindly accept `origin === "null"` as sufficient trust.

### 8.3 If SP1 fails [D/C]

- Disable public **interactive** custom JS; publish trusted library behavior and sanitized/verified static content only where it can be **produced without running untrusted React in privileged context**. A browser-based isolated builder may generate static output only after explicit sandbox proof.
- Untrusted custom source remains stored/exportable and editable. UI shows unsupported public behavior and exact manual route: export project to run on independent hosting under user's control.
- Do not weaken CSP, move code onto `kadmeion.vercel.app`, or silently reintroduce an unrelated cloud compilation backend to meet a demo date.

### 8.4 Publish gates and failure modes [C/S]

Pipeline: `Freeze revision → validate structure/public completeness → compile/build in isolated permitted environment → generate HTML/CSS/assets → verify trusted script manifest & sanitization → accessibility/SEO/performance/security/cost/rights checks → upload private immutable objects → atomically switch pointer → fetch public page → verify bytes & headers → record release`.

**Failure handling:** before pointer switch previous release stays live; after switch a mismatch triggers *conditional* rollback if prior pointer still valid. Never report “auto-reverted” if rollback itself failed—raise a critical incident and disable publication path. Versioned static assets can remain cached; visibility changes and erasure need specific cache behavior validated in the host PoC.

## 9. Public URL, delivery, visibility and discoverability

### 9.1 Desired routes [D/S]

| Route | Function |
|---|---|
| `https://kadmeion.vercel.app/<username>/<portfolio-url>` | Published portfolio, subject to reserved slug/host availability |
| `/<username>` | Optional default portfolio alias [C], not required for v1 |
| `/app/...` | Authenticated editor |
| `/r/<opaque-token>` | Expiring reviewer staging link; access checked server-side |
| `/api/...` | Do not assume independent Node business API; Supabase endpoints handle owner data |
| `/assets/<hash>` | Static assets via delivery bridge or approved trusted CDN |
| `/_not-found`, private/unpublished | No owner data disclosure; consistent route responses |

**Names:** lowercase ASCII slugs, length/reserved-word validation, owner-scoped uniqueness, rename redirects; exact bounds are [A] (Hybrid suggested usernames 3–30 and slugs 3–40). Handle/domain availability is **unverified**. For privacy, old public URLs and redirects must be disabled immediately on unpublish/delete.

### 9.2 Delivery adapter, not assumed free magic [C/S]

- A **release store** holds immutable versioned bytes and content metadata, distinct from the Supabase editable database. A small **pointer** identifies currently authorized release and visibility, with a revocation/tombstone path. The host-side route must enforce public/private/unlisted state *before* serving sensitive HTML or assets; immutable release IDs must not become bypass URLs.
- **[V] Vercel Blob public URLs do not directly serve HTML as web pages.** A thin Vercel frontend route handler that reads release bytes and returns `Content-Type: text/html` is one possible solution; its caching, size, quota, wildcard route and deletion behavior **require SP5**, and it cannot run arbitrary user code. A static-deployment approach is another candidate, but per-user deployments/build frequency are not assumed free.
- **[V] Supabase Edge Functions on the default host rewrite `text/html` GET responses to text unless custom domains are used** and have a 2-second active CPU/request limit. Therefore they cannot be asserted as a turnkey free HTML-rendering host. Supabase remains the agreed backend for account/data workflows, not a proven public HTML CDN.
- **[V] Vercel Hobby is offered at the provider's discretion for personal/non-commercial use;** public open-registration user-generated-site hosting may require a terms/fair-use review and can be terminated. A capstone label does not independently certify hosting permission. Vercel release path remains conditional until terms and abuse provisions are checked. Do not substitute a paid plan without user approval.
- The **demo resilience contract** is an offline runnable sample project/static-site zip and local browser editor test. Nothing can make the exact Vercel URL survive loss of Vercel itself; failure is disclosed.

### 9.3 Visibility, revocation and search [C]

| State | Delivery rule | Search policy | Sharing |
|---|---|---|---|
| Private draft | Authenticated owner only; no raw public release access | Not indexed | No public link |
| Staging review | Signed/random unguessable token, server-enforced expiry/revocation; `noindex`, `no-store` | Must not index | Deliberate expiring link |
| Unlisted release | Anyone holding URL may view; **not confidential**; no browse directory | `noindex`; do not assume engines obey immediately | Link holders |
| Public release | Anyone; approved SEO and social cards | Indexable by default | Public URL |
| Disabled/deleted | Pointer tombstoned; previously served public routes should return appropriate unavailable status and cache policy | Deindex/purge requested where feasible | Old links fail; cached copies may remain outside control |

**Cache policy:** immutable hashed assets may be cached, but HTML and visibility pointers need bounded freshness and correct revocation. Privacy-critical previews use `no-store`. Immediate public unpublish is an application policy, but third-party caches/search archives cannot be erased instantaneously by declaration; disclose this residual risk. Old release assets must not expose private information via direct public object URLs.

### 9.4 Public quality and SEO

Pre-render real user-visible content into HTML; semantic headings and landmarks, `lang`, canonical URL, description, robots directive, Open Graph/Twitter cards, optional sitemap, verified internal/external links, accessible images and print styles. Test with JavaScript disabled and real crawler fetches. If pre-rendering fails, **block “SEO-ready public release”** or surface an explicit degraded feature and get user authorization; a client shell with only metadata is not equivalent to indexed portfolio content.

## 10. Storage, browser tiers and free-tier survival

### 10.1 Adapter contract [D/C]

`list/read/write/delete/stat` with revision fingerprints, optional `watch`, and typed errors. The same core uses **BrowserStore** (IndexedDB), **FolderStore** (native writable handles if capability exists), **Zip import/export**, and **CloudSync** (Supabase owner data with RLS). One active authoritative store per session; mirrors verify revision and are never assumed synchronized until acknowledged.

### 10.2 Browser support: honest tiers [D/V/S]

| Tier | Environment | Public pages | Editor core | Native folder access | Source editing |
|---|---|---|---|---|---|
| A | Desktop Chromium-family (Chrome, Edge, compatible) | Yes after route test | Templates, slots, content, history, preview, publish | **Capability-gated writable mode** using `showDirectoryPicker`, requiring HTTPS and user gesture | Monaco candidate, tested via S7 |
| B | Desktop Firefox/Safari | Yes after route test | Same editor core via browser store/ZIP; graceful gaps | No equivalent writable `showDirectoryPicker` guarantee; ZIP import/export/fallback | Desktop code editor as actually tested |
| C | Modern phone/tablet engines | Yes | Tap-to-place, content/media, responsive preview, save/export; publish when service available | Not promised, feature-detect | Monaco **not supported on mobile according to its project**; accessible limited text editor or view-only |
| D | Legacy/no JavaScript | Public **static HTML** where browser renders it | Not supported | None | None |

“All browsers” means a tested accessible core across major modern engines, **not** identical support for desktop folder APIs or unsupported old versions. Playwright Chromium/Firefox/WebKit automation is necessary but **not sufficient**: at least one real iOS Safari, Android browser, desktop Safari/Firefox and Windows Chromium device/browser confirmation is a release gate. `showDirectoryPicker` is limited availability [V]; **whether Android supports it is feature/device-dependent, not a stable promise**.

### 10.3 Local-first data safety [C]

- Browser IndexedDB is *best effort* and can be evicted; Safari/WebKit ITP can delete script-writable site storage after seven days without site interaction [V, conditional on browser/home-screen rules]. Calling `navigator.storage.persist()` is not a guarantee. Never make a lone browser copy the user's only backup without explicit warning.
- Local-folder mode is in v1 for capable browsers. It saves real files and can be edited in VS Code; on permission loss the editor retains a separate recoverable browser draft and offers reconnect/ZIP export. **Do not claim two stores are safely mirrored until a comparison/acknowledgment proves it.**
- Export project archive, static web archive, offline demo package and clear location indicators. Periodically encourage backups; no dark pattern. A full migration/export to independent host should be rehearsed on local `localhost` static serving, not just by double-clicking a `file://` HTML page (module/CSP support differs).
- Cloud sync via Supabase is optional for offline editing but required for authenticated publishing/account portability; Supabase pauses low-activity free projects [V]. If paused, the editor remains locally usable, cloud features clearly degraded, published independent releases remain available **only if R36/SP5 passed**.

## 11. Supabase-only backend and account operations

### 11.1 Current platform choice [D]

**Supabase Auth (email; optional Google), PostgreSQL with RLS, Supabase Storage and Edge Functions / Postgres RPC** are the only target business backend services; no MongoDB/Mongoose/Express API server. Existing DevFolio legacy records, if any, must be inventoried before separately authorized migration—never deleted based on the statement that there are no real users. This is an architectural selection, not execution authorization.

### 11.2 Core persistent entities [C]

| Entity | Fields and rule |
|---|---|
| `accounts/profiles` | Supabase Auth subject, username/handle, account privacy flags; public projection excludes email/tokens |
| `portfolio_projects` | owner ID, project ID, title/slug, visibility, draft status, pinned format version; RLS owner-only writes |
| `portfolio_revisions` | owner/project, `revision_id`, `parent`, hash-map/manifest pointer, actor, timestamp, reason; immutable append-only |
| `portfolio_files` | content hashes and private object locations; external users never access raw private editor sources |
| `assets` | owner, hashed storage path, type/size/alt metadata, rights/publication visibility |
| `publications` | project ID, frozen revision, release ID, build hash, preflight result, status, release pointer |
| `reviewer_links` | hashed token, bounded expiry, revocation, revision ID; server-check every access |
| `usage_limits` | resource/account caps, total bytes/releases, rate-limit policy and abuse indicators |
| `moderation_cases` | narrowly scoped report/takedown/appeal audit, no admin editing of users' content |

**RLS baseline:** public identity fields exposed only through deliberate projections; user-defined content is private before publication; uploads accept only owner-scoped paths and declared size/quantity; admins cannot editorially rewrite legitimate portfolio content. Use SQL policies and tests for anonymous, owner, other user and operator roles, including direct API calls and malicious path/ID manipulation.

### 11.3 Account/product boundary

- Local anonymous editing may be offered without account [C]; publishing to shared domain requires a real Supabase-authenticated owner (email flow subtype password vs OTP/magic-link still open).
- GitHub link optional; repository ownership/genuine authorship proof not required for project creation; author-provided evidence labeled accurately. Imported provider data private by default, opt-in for public use.
- Supabase Free is constrained (as-of §19), can pause; no automatic upgrades. Resource quotas, warning thresholds, disconnection delete/retain choice and account deletion/Trash must follow prior decisions.

## 12. Accessibility, interaction and Kadmeion design

### 12.1 One editor workbench [C]

```text
HEADER: portfolio name | [Saved in Browser / Folder / Cloud] | Undo/Redo | Device | Preview | Publish
LEFT: Sections · Components · My Components · Assets · Templates
CENTER: Real canvas with semantic slot overlays; responsive widths
RIGHT: Contextual Content · Properties/Theme · [Code] · Slot info
BOTTOM: Problems · Console (isolated) · History/Compare (collapsible)
ADVANCED: Project files · Inspect provenance · Build report · Export
```

Template beginners see the content editor first; selecting Visual reveals compatibility-aware dragging/reordering; Source opens read-only generated usage and explicit Customize to create owned code; Blank starts without sections and permits adding custom layouts through declared slot contracts. **The old idea of four separate applications is rejected.**

### 12.2 Usability rules [C]

- Every drag interaction has a keyboard and tap-to-place alternative. A slot has a clear label (“Hero title — headings only”), visible compatible drop targets and informative rejection.
- Always show meaningful save and preview freshness state; no decorative fake analytics or mocked success labels. Error UI: **what happened → why → fix → recover/Undo**. Problems links select the specific file/field.
- Preview should not claim content updated if custom compilation failed; retain the last-good frame with a stale/error badge.
- Responsive: large desktop three-pane, tablet overlapping inspector, mobile single active editing panel; focus and soft keyboard never hidden behind modal/animation. Reduced motion and contrast apply to editor *and* published pages.
- Kadmeion glyph-shaped skeleton **replaces** normal grey skeleton bars during true loading; never persists as sample text, never inserts artificial waits. Identity graphics are static sparse K-derived SVG/CSS on appropriate surfaces, not monument illustrations. Auth signup/login slide is reversible and interruptible. Product UI must remain usable with animation disabled.

### 12.3 v1 experience journeys [D/C]

`F1` first portfolio; `F2` swap; `F3` delete/restore; `F4` customize code; `F5` swap over code; `F6` change layout; `F7` publish/rollback; `F8` reviewer staging; `F9` folder mode; `F10` invalid external edit; `F11` blank custom build; `F12` cross-device conflict copy; `F13` ZIP/static export. The original Spec A F1–F10 and Perspective B FB1–FB9 are treated as **source-scoped** identifiers to avoid collisions; complete flow mapping in Appendix E.

## 13. Quality invariants, error handling and states

### 13.1 Final meaning of I1–I24 [D/C]

The hybrid I1–I24 IDs remain stable. They are **target properties**, unproven until suites pass. Critical qualifications:

- **I1/I2 (no data loss / restorable):** apply to committed, retained editor content and backups available within disclosed policy; browser/device destruction, deliberate permanent deletion and inaccessible hosts remain explicit risks.
- **I3 (preview parity):** same pinned input/build plus measured render/DOM parity for tested environments; custom JS-disabled public output is clearly previewed separately.
- **I4/I12/I23:** no untrusted code can reach public privileged origin; every binary/script must have provenance; build/preview sandboxes are adversarially tested.
- **I6/I7 (slot isolation):** error boundaries/local CSS do not contain arbitrary malicious JavaScript; sandbox is separate.
- **I9/I11:** structural save validity is different from required-for-publish completeness.
- **I16:** minimal diff guarantee is conditional on SB1 exact-text tests; any ambiguous write is refused.
- **I17:** only passes with proven DB-independent release delivery; static bytes in Supabase Storage alone do not establish this.
- **I18/I20:** reproducible hashes and pointer atomicity require host-specific implementation/failure tests, not just deterministic hashing in memory.
- **I21:** browser lock is advisory; authoritative compare-and-swap/fingerprint check enforces across tabs/devices.
- **I22:** append-only normal revisions while retained; compliant deletion and GC take precedence.
- **I24:** zero third-party requests is a *default policy for generated pages*, not necessarily every user-supplied external link and consented embed.

The complete invariant register, original wording, enforcement, changed interpretation and test type is in **Appendix D**, to avoid losing the 24 IDs. Never mark any invariant “passed” before code/tests exist.

### 13.2 Error catalogue

**E01–E30** retain Hybrid §26.2 meanings and are maintained in Appendix D. Standard message payload: `{code, severity, targetSlot/file, reason, safeNextActions[], recoverability, lastGoodRevision?}`. Include human-focused action words and a “Details” link. Two additional categories are architect additions (do not renumber older ones):

- `E31` [C] **Security isolation not proven** — “Custom scripts cannot be published safely yet; export your source or publish the supported static version.”
- `E32` [C] **Publishing host unavailable/terms or routing unsupported** — “This hosting path is not available. Your local project and static export remain intact.”
- `E33` [C] **Preview stale** — “This preview shows the last working version; fix the highlighted source error to update it.”
- `E34` [C] **Deleting/unpublishing may leave external cached copies** — “The Kadmeion link is disabled. Previously cached copies may remain outside Kadmeion’s control.”
- `E35` [C] **Project import contains unsafe active code** — “Code was imported without execution. Review it before using the restricted preview.”
- `E36` [C] **History no longer retained** — “That restore point expired under your disclosed retention policy; export or restore an available copy.”

### 13.3 State machines

- **Slot:** EMPTY ⇄ S0 ⇄ S1/S2; ERROR is an orthogonal compile/runtime overlay; confirm on user-owned S1/S2 replacement.
- **File:** VALID ⇄ INVALID-SYNTAX / INVALID-SCHEMA / INVALID-REFERENCE; CHANGED-UNDER-US is a conflict state; UNKNOWN-KEYS is nonfatal warning.
- **Editor:** CLEAN → EDITING BUFFER → COMMITTING → SYNCED or UNSAVED/ERROR, with visible local/folder/cloud status.
- **Preview:** STARTING → READY → UPDATING → READY or DEGRADED-LAST-GOOD / RESTARTING; publish never uses silent degraded frames.
- **Release:** DRAFT → FROZEN → VALIDATED → BUILT → GATED → UPLOADED → POINTER-SWITCHED → VERIFIED; failure before switch leaves previous live; mismatch after switch attempts rollback and escalates if unsuccessful.

## 14. Test matrix and acceptance criteria

### 14.1 Verification layers [C]

| Suite | What it proves | Required case |
|---|---|---|
| Schema + contract | Valid/invalid project and component samples | Every slot/fits and unknown-key policy |
| Property + fuzz | Random operations preserve values, IDs, recovery, guard states and inverse behavior | Sequences 1,000+ [A target], shrinking failures |
| Golden text | Untouched bytes/comments preserved on `editContent`, `swap`, `changeLayout` | SB1 corpus; fail closed if parser changes comments |
| Canvas integration | Puck adapter or fallback handles nested/irregular slots | S1 live experiment |
| Compiler + preview | Source compilation, source-map errors, last-good, hang recovery | S2/S7 fault injection |
| Auth/DB/RLS | Other user cannot read or mutate private portfolio/asset/revision | Synthetic records in isolated Supabase PoC |
| Storage | IndexedDB transactions, folder interruption, eviction/export, ZIP bombs | Browser/OS/permission matrix |
| Concurrency | Duplicate tabs, divergent offline edits, replayed operation IDs | CAS and conflict copies |
| Publish delivery | Public/unlisted/private/404/rename/rollback and database paused | Host/browser test from external client |
| Custom code isolation | Embedded and top-level direct-open iframe escape, cookie/storage/API requests, CSP, postMessage confusion | SP1 with hostile test pages; no privileged access |
| Rendering parity | Preview-as-published and released bytes at tested widths | DOM/visual/hash comparisons |
| Accessibility | WCAG 2.2 AA-oriented automation + manual keyboard/screen-reader | Editor and every published preset |
| Performance | Content edit, swap, source compile, opening saved project, public LCP/CLS/INP | Repeated runs under documented device/network settings |
| Usability | 5 new testers mixed noncoders/coders: F1,F2,F5,F7 + folder where supported | 4/5 per task [A], comprehension recorded |
| Cost and resilience | Forced provider outage; ₹0 operating ledger; offline start and static export | No internet replay, alternate local host |
| Licence/rights | Dependency, font, SVG, sample assets and component licences | SBOM; no unknown redistributable file |

### 14.2 Acceptance/quality budgets [A]

Target **WCAG 2.2 AA** for app and public templates; no serious/critical automated violations; manual keyboard and screen-reader passes. Start with a ~150 KB gzipped JavaScript budget for mostly static public pages **only if measured and feasible**, pre-rendered content without JS, properly sized images, high-contrast text and responsive variants. Initial editor feedback targets: content under ~100 ms visible, swap under ~300 ms, typical custom-source preview under ~300 ms after debounce, project open under ~2 s, publish under ~60 s and rollback under ~5 s—**hypotheses, not guarantees**. Log 95th percentiles and tune based on measured end-to-end tests; do not fail a user’s release on a noisy external network metric alone.

### 14.3 Definition of Ready / Done

**Ready:** target experience, contract, ownership, valid/invalid/hostile fixtures, error message, security assumptions, cost, and test exit condition documented. **Done:** tests witnessed green; visual/responsive/manual a11y checks; failure mode reachable; recovery behavior demonstrated; docs/ADR updated; at least one outside tester confirms. No test suite in this document was run.

## 15. Phased build order (planning, not permission)

| Gate | Work package | Must demonstrate before continuing | Do not silently omit |
|---|---|---|---|
| **P0** | Evidence, wireframe inventory, five contracts, stable IDs, schema/version policy, source-file budget ledger | Sample projects parse; R01–R47 and H1–H21 mapped | Trust/retention choices |
| **P1** | **Authorized isolated feasibility experiments only** with synthetic data: Supabase Auth/RLS/Storage/Edge, editor candidate, JSONC edits, static delivery/SEO, sandbox, browser folder support | Each spike S/SB/SP has go/no-go report and fallback; no production data/repo edits | Public hosting/JS security blockers |
| **P2** | Minimal **vertical slice**: L1, trusted heading/CTA/image, content editing, local history, deterministic static export; publish URL if feasible | Undo, export, last-good and core rendering proven | Never block local slice on provider if offline mode can demonstrate |
| **P3** | Durable operation engine, typed stash mapping, S0–S2, Undo, linear snapshots, migration/version pin, Grammar Guard and two-tab recovery | I1,I2,I8–I10,I13–I16,I21–I22 test evidence | No user data loss |
| **P4** | Other layouts and component variants, responsive theme/image assets, L6–L8 and five presets | Slot compatibility × viewport × stress content matrix | Distinct portfolio-quality designs |
| **P5** | Advanced source mode, user code overrides, Monaco desktop, mobile fallback, custom components and blank layout | S2/S7/source isolation pass; unsupported-case notices | Do not enable unsafe public JS |
| **P6** | Supabase-only account/sync/owner database; release service/public route; gates, staging, rollback, reviewer links | Auth/RLS, public route, database-off release, cache/visibility, publish failure tests | No business backend parallel stack |
| **P7** | Folder adapter (capable desktop browsers), zip imports/exports and offline demo; conflict/import recovery | External edits, permission revocation, crash journal, provider-loss drill | **Folder mode is a v1 owner commitment**, not expendable by default |
| **P8** | Inspector provenance, Problems, component conformance, documentation, licensing/rights, real-device usability, privacy/security hardening | Tech-lead independent review and v1 acceptance matrix | Clarity and external proof |

**Order dependency:** P0 → P1 → P2 → P3 → P4/P5 (can overlap cautiously) → P6/P7 → P8. This is a dependency sequence, **not** a date commitment. P1 is the only recently authorized test domain and must use isolated synthetic data, not live project or provider operations. All later implementation gates require new approval.

### 15.1 Scope cuts, in order [C]

Remove optional animations, minor component variants, optional `/explore`, advanced visual compare, additional template presets/layouts **beyond the owner's v1 chosen five presets and eight layouts only after explicit scope revision**; postpone Git sync, public SDK distribution, CLI, branches, marketplace, multiplayer, AI, contact form, custom domains, resume PDF and analytics beyond the current editor baseline. **Never cut:** file non-loss, typed operation guard, protected source, basic restore/ZIP export, code sandbox gate, secure ownership/publishing checks and the committed v1 folder adapter without discussing a changed requirement with the owner.

## 16. Premortem, kill rules and postmortem

### 16.1 Priority failure modes [C]

| Failure | Early warning | Prevent/contain |
|---|---|---|
| Editor becomes two conflicting truths | Code differs from canvas after rename/undo/external file change | One transactional engine, stable IDs, repair-only feedback, random action tests |
| JSONC comment corruption | Inline comments drift after adding keys | SB1 golden tests; refuse unsafe patch / replace machine format only with explicit ADR |
| User-owned source overwritten | S2 swap does not warn or source diff unexpectedly changes | Intent ownership boundary, stash, protected source hash checks |
| Browser-only data vanishes | Safari/eviction or permissions revoke without backup | Explicit storage label, persistent request not guarantee, ZIP/export reminders, folder/cloud alternatives |
| Public URL not truly static/SEO-ready | Blob URL downloads HTML or Edge returns text/plain | SP5 real HTTP serving test and crawler/no-JS check before release |
| Custom JS escapes sandbox | Direct-open run URL can read cookies/call privileged APIs | SP1 adversarial proof; hard stop JS publication if any escape |
| Supabase free tier pauses | Cloud login/sync unavailable | Offline local mode; independent release service where viable; realistic status UI |
| Vercel Hobby terms/quotas disallow open UGC | Host warns/suspends or permission unclear | Terms verification, quotas/abuse prevention, export fallback; **do not imply legal/plan clearance** |
| Eight layouts/five presets consume all engineering time | No complete export after early phases | Vertical slice first; reduce optional variants; require milestones and honest scope re-approval |
| Fake analytics/verification/metrics | Sample data leaks into public page | Sample placeholders gate, author-labeled evidence, truthful published fields |
| Deletion contradicts immutable release policy | Deleted content remains reachable through old release object URL | Access-controlled release store, tombstone, purge and lifecycle tests; acknowledge unavoidable external caches |
| One-off developer cannot maintain code | >200-file cap, many wrappers/SDK endpoints | Thin adapters, compact contracts, one Core, ADRs, testable docs |

**Kill rules:** any code-loss regression disables destructive swap; any sandbox privilege leak disables public custom JS; any invalid release pointer disables publish endpoint; any provider charge risk above cap freezes provider work; any accessibility blocker in required workflows prevents “done”; any unrecoverable folder-journal mutation disables folder writes until fixed. These are operating **policies for future implementation**, not presently triggered incidents.

### 16.2 Retrospective / measurement

After every phase record predicted vs observed, failing invariants, user confusion, cost, license checks, new risks, which [A]/[S] gained evidence, and accepted cuts. For v1, require a scripted *independent* review: non-coder template/publish; developer slot/override/invalid-code recovery; two-tab conflict; direct-file edit in supported browser; mobile content workflow; public URL/SEO and expiry; database pause simulation; source/static ZIP deployed to an alternate local host; rollback bytes match. No claims of zero bugs, permanent hosting or security certification from test counts alone.

## 17. Things overlooked: product, legal, privacy and operations

| Topic | V1 handling or explicit deferred path [C/A/S] |
|---|---|
| Accounts, identity and GitHub claims | Supabase Auth; truthful ownership labels; optional GitHub; never force repository |
| Terms, privacy, abuse and takedown | Minimal usable notices, operator contact, documented serious-abuse temporary unpublish/notice/log/appeal. **Legal applicability requires external qualified review** |
| Hosting fair-use and non-commercial classification | Check user-generated public portfolios against live terms; enforce quotas/caps; don't infer “capstone” automatically grants unrestricted host rights |
| SEO/social | Build HTML, canonical, OG, title/description, robots/404, sitemap for opted-in public pages |
| Editor accessibility and internationalization | Keyboard/touch/screen reader; `lang`, direction, text expansion, font-script coverage; English UI initially, UTF-8/RTL content tested where supported |
| Dark mode and approved brand | Editor dark/light; public theme from owner tokens, contrast tested; glyph skeleton with genuine pending state only |
| Anonymous analytics | Privacy-conscious aggregate only if separately in product scope; no visitor fingerprinting/persistent IDs, default off in editor build |
| Custom domains/print résumé/PDF | Deferred; portable site/print styles now when inexpensive |
| Contact forms | Mailto/social links in v1; server-side form requires rate limiting, spam, safety/abuse review |
| 404/private/unpublished | Route returns appropriate minimal responses; no private profile leaks |
| Browser/mobile/folder support | Capabilities/tier table and real-device confirmation; truthful exception for Monaco mobile |
| Concurrency and storage eviction | CAS base revision, conflict copy, local recovery, ZIP fallback |
| Versioning and deprecation | Pinned manifests, migration corpus, no auto-altering published releases |
| Licence/dependencies | MIT project choice; record exact dependency/font/icon/image licence & hash; verify compatibility on adoption |
| Documentation & incident response | Architecture one-pager, five contracts, known limits, security threat model, operations and provider-loss playbook, migration notes, changelog |
| Privacy-preserving diagnostics | Client-side copyable scrubbed error report; opt-in external diagnostics only, no secretly uploaded source |
| Name/domain/trademark | `kadmeion.vercel.app` and Kadmeion trademark availability unverified; check before public release |
| Moderation and user-generated pages | Report abuse link, bounded takedown, no arbitrary user HTML forms/JS on privileged origin |
| Backup retention | 15-day private Trash and disclosed fixed backups, no indefinite immutable “never delete” promise |
| Tool version/OSS | Pin Puck or fallback, browser compiler and others only after license/source/compatibility check |
| OSS-vs-cloud boundary [addition] | App packages and shipped code must use open-source licenses [D]. Supabase and Vercel are selected third-party hosted infrastructure, not a claim that every vendor service is itself open-source. Maintain offline/project exports and an escape path rather than presenting proprietary provider control as an OSS dependency. |
| OSS-vs-cloud boundary [addition] | App packages and shipped code must use open-source licenses [D]. Supabase and Vercel are selected third-party hosted infrastructure, not a claim that every vendor service is itself open-source. Maintain offline/project exports and an escape path rather than presenting proprietary provider control as an OSS dependency. |
| OSS-vs-cloud boundary [addition] | App packages and shipped code must use open-source licenses [D]. Supabase and Vercel are selected third-party hosted infrastructure, not a claim that every vendor service is itself open-source. Maintain offline/project exports and an escape path rather than presenting proprietary provider control as an OSS dependency. |
| Credibility blocks [addition] | Project facts manually labeled, source attribution with confidence; no fabricated verification badges |
| Preview truthfulness [addition] | Side-by-side “Author runtime” vs “As published” for degraded custom behavior |
| Cache revocation [addition] | Test CDN and direct-release URL bypass on visibility changes and deletion |
| Reproducibility [addition] | Include build toolchain manifest, asset/hash integrity and environment ID in release report |

## 18. Open questions (owner-only vs delegated)

**Owner-only, genuinely open:**

1. **Authentication subtype:** ordinary email with password, passwordless OTP/magic link, or both? The decision established normal email with optional Google, but not the precise email flow. This affects account-recovery and free email delivery feasibility.
2. **Release degradation policy if hosting/security spikes fail:** preserve the v1 requirement for public interactive custom JavaScript at any cost of delay, or accept a fully functional static public portfolio v1 with custom JS editable/exportable but not executed for public visitors? Recommended default is **static public output**, no privilege bypass; this changes only public custom interactions and must be communicated.
3. **Untruncated feature rows and wireframe images:** please supply exact missing rows **1,2,9–12** and L1–L5 originals if you want source-exact provenance; this does not prevent the current planning blueprint.

**Not owner questions unless constraints change:** Puck vs custom adapter; JSONC library; exact file naming; MIT; template names; one-file-per-slot; history representation; no CLI; default absence of variants; folder availability tiers; choice of release store under the cost cap. These are architect decisions/spikes, not further interviews.

## 19. Evidence and source verification index

Public vendor documentation checked on **12 November 2026**. Each [V] applies only to the stated doc claim; no deployments or code tests were run.

| Source ID | Verified point | Official/primary source | Date/qualification |
|---|---|---|---|
| V01 | Vercel Hobby is for personal/non-commercial use and may be discontinued or deployments disabled; it is not guaranteed permanent free hosting | https://vercel.com/legal/terms | Published ~Oct 2026; accessed 2026-11-12 |
| V02 | Vercel issues first-come-first-served `*.vercel.app` deployment names; desired hostname cannot be assumed reserved | https://vercel.com/docs/domains/working-with-domains | Updated Jan 2026; accessed 2026-11-12 |
| V03 | Vercel Blob direct public URLs do **not** serve HTML as pages; content disposition prevents HTML-hosting | https://vercel.com/docs/vercel-blob/public-storage | Updated Mar 2026; accessed 2026-11-12 |
| V04 | Supabase free quotas include 2 active projects, 500 MB DB/project, 1 GB storage and 5 GB egress; low-activity Free projects may pause | https://supabase.com/docs/guides/platform/billing-on-supabase ; https://supabase.com/docs/guides/platform/free-project-pausing | Updated Sep 2026; quotas subject to change |
| V05 | Supabase Edge Functions hosted limits currently 256 MB memory, 2 s active CPU/request; GET text/html rewrite without custom domain | https://supabase.com/docs/guides/functions/limits | Updated Oct 29 2026; accessed Nov 12 |
| V06 | `showDirectoryPicker()` is limited availability, experimental and requires secure context | https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker | Accessed 2026-11-12; real support matrix still needs SP3 |
| V07 | Browser storage is best effort; `persist()` can be requested, and browsers may evict data | https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria | Accessed 2026-11-12 |
| V08 | WebKit documents seven-day script-writable-storage deletion after no first-party interaction, with exceptions | https://webkit.org/tracking-prevention/ | Accessed 2026-11-12; do not assume every iOS web app case identical |
| V09 | Monaco project uses MIT and reports mobile browser support: **No** | https://github.com/microsoft/monaco-editor | Accessed 2026-11-12 |
| V10 | Puck has MIT licence; its `slot` field and allow/disallow rules are documented | https://github.com/puckeditor/puck ; https://puckeditor.com/docs/api-reference/fields/slot | Accessed 2026-11-12; Kadmeion suitability still S1 |
| V11 | esbuild documents browser WebAssembly/Web Worker API (`esbuild-wasm`) | https://esbuild.github.io/api/ | Accessed 2026-11-12; actual multi-file safe integration still S2 |
| V12 | `jsonc-parser` supports modify/applyEdits, but a 2026 issue reports inline-comment reassociation | https://github.com/microsoft/node-jsonc-parser ; https://github.com/microsoft/node-jsonc-parser/issues/125 | Issue opened Jun 28 2026; SB1 required |
| V13 | CSP sandbox and iframe sandbox semantics; untrusted same-origin script+`allow-same-origin` risk | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe | Accessed 2026-11-12; SP1 must test concrete context |
| V14 | Cloudflare Pages Free has a documented monthly build allowance and file limits (candidate fallback, not selected) | https://developers.cloudflare.com/pages/platform/limits/ | Updated Sep 2026; infrastructure suitability [S] |
| V15 | Supabase Free backup downloads and provider recovery mechanisms have limits; do not use provider free tier as the only backup | https://supabase.com/docs/guides/deployment/going-into-prod | Accessed 2026-11-12; policy remains open |

**Evidence downgraded deliberately:** static HTML from a release store, Puck irregular nested canvas fit, safe custom-code compilation, JS origin isolation, React SSR parity, JSONC comment stability, browser folder journaling, all-device editing, free-tier UGC compliance, exact hostname availability and public release rollback **are all [S]** until tested. Tool licences of other unselected packages remain [S], not blanket [V].

## 20. Glossary (used once, consistently)

| Term | Meaning |
|---|---|
| **Canonical file set** | Committed version of all authored project files; durable source of truth |
| **Parsed project graph** | Validated internal tree reconstructed from canonical files for all lenses |
| **Slot** | Typed named region of a layout with accepted component contracts |
| **Assignment** | Pinned component/override or EMPTY attached to a slot |
| **Lens** | Canvas, source, layers, inspector, preview or history view of the same revision |
| **Operation** | Typed intent submitted to one writer, with validation, recovery and base revision |
| **Grammar Guard** | Prevents editor writes to structured files it cannot safely parse/patch |
| **Override** | User-owned full source file replacing a trusted library component in one slot |
| **Unplaced tray / stash** | Recovery storage for content/assets/code that no longer fit after structural edits |
| **Revision / restore point** | One immutable committed snapshot / user-named checkpoint on a linear history |
| **Release** | Immutable, built public artifact of one frozen revision |
| **Release pointer** | Small controlled record deciding which release a public path may serve |
| **Delivery bridge** | Host-specific minimal static-byte route service; not the core business backend |
| **Run origin** | Separate, restricted origin for executing untrusted custom code, if safely supported |
| **Spike** | Bounded synthetic-data experiment with defined pass/fail, evidence and fallback |
| **Gate** | Required validation/test stage before allowing publish or production adoption |


---

## Appendix A. Complete received-file inventory and read protocol
All Markdown inputs below were decoded end-to-end from their exact mounted bytes. Duplicate uploads were compared by SHA-256 and are byte-identical to the named canonical originals; six **unique** source texts, eleven input files in the active directory. The original five wireframe **image files** and original complete D01–D90 pasted feature table are not mounted in this turn; their appearance/omitted rows are not inferred.
| Source | File received | Type | Bytes | Lines | Read fully? | Duplicate integrity |
|---|---|---|---:|---:|---|---|
| T1 | Kadmeion Portfolio Builder Task 1 — Recommendation, Approach and Premortem(1).md | Markdown | 36281 | 378 | Yes; end-to-end, headings and IDs indexed | SHA-256 `f6b422913617` |
| T2 | Kadmeion Portfolio Builder Task 2 — The Other Perspective (Project-First, Contra(4).md | Markdown | 29243 | 311 | Yes; end-to-end, headings and IDs indexed | SHA-256 `0e8962b24bd0` |
| T3 | Kadmeion Portfolio Builder Task 3 — The Reference Version (Specified as a Finish(5).md | Markdown | 38076 | 433 | Yes; end-to-end, headings and IDs indexed | SHA-256 `f7b4d760e970` |
| A | Kadmeion-Editor-Spec(6).md | Markdown | 83924 | 1205 | Yes; end-to-end, headings and IDs indexed | SHA-256 `10e965a4f581` |
| B | Kadmeion-Editor-Perspective-B(1).md | Markdown | 52904 | 835 | Yes; end-to-end, headings and IDs indexed | SHA-256 `34f2a471ab28` |
| HYB | Kadmeion-Hybrid-Blueprint.md | Markdown | 145882 | 1860 | Yes; end-to-end, headings and IDs indexed | SHA-256 `15888e71e14e` |
| Copy | Kadmeion Portfolio Builder Task 1 — Recommendation, Approach and Premortem.md | Markdown | 36281 | 378 | Yes (byte-identical) | SHA-256 `f6b422913617` |
| Copy | Kadmeion Portfolio Builder Task 2 — The Other Perspective (Project-First, Contra.md | Markdown | 29243 | 311 | Yes (byte-identical) | SHA-256 `0e8962b24bd0` |
| Copy | Kadmeion Portfolio Builder Task 3 — The Reference Version (Specified as a Finish.md | Markdown | 38076 | 433 | Yes (byte-identical) | SHA-256 `f7b4d760e970` |
| Copy | Kadmeion-Editor-Perspective-B.md | Markdown | 52904 | 835 | Yes (byte-identical) | SHA-256 `34f2a471ab28` |
| Copy | Kadmeion-Editor-Spec.md | Markdown | 83924 | 1205 | Yes (byte-identical) | SHA-256 `10e965a4f581` |
**First pass:** full UTF-8 reads, section analysis and topic extraction. **Second pass:** full UTF-8 re-read, line-numbered heading and ID indexing, old-to-new mapping, and final document checks in Appendix J. Reading text is separate from validating proposed software behavior; no app tests were run.

## Appendix B. H1–H21 decision log (original IDs retained)
This log retains the original Hybrid §2 decision vocabulary; a decision tagged [C] is replaceable by the owner, a claim tagged [S] requires evidence before execution. Each row records the selected mechanism, upside, accepted cost or risk, and controlling rule.
| ID | Original option / decision | Final resolution | Boon gained | Bane accepted / validation | Final home |
|---|---|---|---|---|---|
| **H1** | Hybrid: Perspective B built on Perspective A | Adopt [D] | Trust + safety | Files grammar and sandbox [S] | §4/§6 |
| **H2** | File format: JSON-with-comments (.jsonc) for the fixed-format files; hidden by default, shown under an "Advanced → Project files" view | Adopt conditionally [C/S] | Readable files | JSONC patch/comment fidelity SB1 | §6 |
| **H3** | Licence for your own code: MIT | Adopt [C/V] | Permissive OSS | Dependency licenses separately checked | §17 |
| **H4** | Names: folder layout and file names as in §10.1 (kadmeion.json, pages/*.page.jsonc, content/*.content.jsonc, theme/tokens.jsonc, slots//…). Reserved CLI name: kad (not built in v1) | Merge [C] | Predictable export names | Name migration planning | §6 |
| **H5** | No CLI in v1 | Adopt [D] | Smaller v1 | No native CLI automation | §1/§15 |
| **H6** | History = linear snapshots, named restore points, compare | Adopt [D] | Simple history | No branches; quota/purge needed | §6 |
| **H7** | Local-folder adapter in v1 | Adopt with tiers [D/S] | Local ownership | Picker permission/browser support | §10 |
| **H8** | Variants (branches): not in v1. v1 has "Duplicate portfolio" instead | Adopt [C] | No merging branch histories | Duplication costs storage | §6 |
| **H9** | All browsers | Adopt with tier constraints [D/V] | Broad reach | Native folder + Monaco not universal | §10 |
| **H10** | Public URL: kadmeion.vercel.app//, with hardening (§6) | Adopt as target [D/S] | Simple share URL | Hostname, cache and routing proof | §9 |
| **H11** | Timeline is flexible | Adopt [D] | Evidence-driven ordering | No fixed ship date | §15 |
| **H12** | Portfolio-style slot names: Project, Tech/Metric, Role/Status, Avatar | Adopt [C] | Clear slots | Legacy migration required | §5/§7 |
| **H13** | One file per slot in the code panel, plus a read-only combined view | Adopt cautiously [C] | Slot ↔ file mental model | Generated views must be marked | §6 |
| **H14** | v1 section layouts: the five wireframe layouts (L1–L5) + three supporting sections (L6 Skills, L7 Experience, L8 Contact) + header and footer variants + the blank page; build order L1 → L4 → L3 → L2 → L5 → L6–L8 | Adopt [C] | Portfolio-ready composition | Five image originals absent | §7 |
| **H15** | Swap over edited code: *Keep as custom component / Replace / Cancel*, always with history | Adopt [C] | No silent user code loss | Confirmation friction | §5 |
| **H16** | Platform services: account login, cloud sync and public serving as in §11, with the rule that public portfolios never depend on the database | Merge, conditional [C/S] | Public independent from live DB | Server delivery bridge not proven | §9/§11 |
| **H17** | Framework adapters (D06): React only in v1 | Adopt [C] | Reduced adapter complexity | Limited framework imports | §8 |
| **H18** | Language/stack: TypeScript + React; one Next.js project for editor and public routes | Replace mandatory Next.js [C] | Preserve React/Vite; choose host adapter after proof | Frontend/SSR delivery open SP2 | §4/§9 |
| **H19** | No custom JavaScript on public pages unless sandbox isolation passes spike SP1 | Adopt [C/S] | Conservative safety | No scripted pages until proof | §8 |
| **H20** | Cost target ₹0 (hard cap ≤ ₹1,000) and open-source software only | Adopt [D] | Budget discipline | Cost/terms free tiers volatile | §17 |
| **H21** | Wireframes are section layouts. A portfolio page = a global header + an ordered stack of sections + a footer; each section uses one section layout. The navigation row in each wireframe becomes a header variant. The 5–10 templates are presets that combine a header, sections and a theme. A slot's address is . (for example hero.title). v1 is a single page with anchor navigation; multi-page comes later | Adopt [C] | Section-based complete portfolio | Layout visual fidelity pending images | §7 |

## Appendix C. Exact R01–R33 owner-requirement traceability
All original Hybrid §3 requirement IDs are preserved, including its `P1/P2/E1/P3/P4/P5/K` source tags, without pretending an unavailable pasted feature table has been recovered. The check is the acceptance condition proposed in that source, not a completed test.
| ID | Original requirement (verbatim apart from formatting) | Original sources | Final location | Test proposed in source | Decision |
|---|---|---|---|---|---|
| **R01** | Build portfolios by visual composition, editable templates, or advanced source; no mandatory coding for normal creation | P1 (D03) | §1/§3 | Usability test: non-coder publishes unaided | Adopt [D] |
| **R02** | Curated template library, about 5–10; modify layout, type, content, media, styling, responsive behaviour; or blank canvas | P1 (D04), E1 Q31 | §1/§3 | Each layout passes matrices (§27) | Adopt [D] |
| **R03** | Custom component builder: configurable code-backed components; position, reorder, customise, combine; save reusable components and collections | P1 (D05) | §7 | Save and reuse a component across two portfolios | Adopt [D] |
| **R04** | Advanced code editor: HTML/CSS/JS, multi-file workspace, JS modules, approved bundled dependencies, selected framework adapters | P1 (D06), E1 Q31/Q34 | §5/§6/§8 | Multi-file edit compiles; dependency allowlist enforced | Adopt [D] |
| **R05** | Visual/code sync for supported components; unsupported custom source preserved with clear limits, never silently modified | P1 (D07), P2 | §5/§6/§8 | Golden test: bytes in = bytes out (I13) | Adopt [D] |
| **R06** | Responsive editor: desktop/tablet/mobile previews, responsive defaults, breakpoint overrides, Grid/Flexbox/positioning controls | P1 (D08) | §7/§12 | Responsive matrix | Adopt [D] |
| **R07** | Preview and staging: live inspection, private drafts, staged versions, reviewer links with expiry | P1 (D13) | §9 | Expiry test; staged ≠ live | Adopt [D] |
| **R08** | Explicit publishing, stable public URLs, versioned static snapshots, validation, release history, rollback, discoverable public pages | P1 (D14) | §9 | Publish → rollback → verify scenario | Adopt [D] |
| **R09** | Out of scope: automatic conversion of arbitrary external HTML/CSS/JS into visual components | P1 | §1/§3 | Not built; imports open as opaque islands | Preserve / flag open [D/A] |
| **R10** | Requirements are product requirements, not claims of implementation | P1 | §1/§3 | — | Preserve / flag open [D/A] |
| **R11** | Reverse-engineer the feature; say how to build it and make it successful; reach its full potential; pre- and post-mortem; planning only | P1 | §1/§3 | — | Adopt [D] |
| **R12** | Slot-based layouts shown by five wireframes; up to ten layouts/templates | P2, E1 | §1/§3 | One catalogue entry per wireframe | Preserve / flag open [D/A] |
| **R13** | Library of pre-built React components that fit the layout slots | P2 | §7 | Drop matrix (every component × every fitting slot) | Adopt [D] |
| **R14** | Replacing a component: delete from the canvas, then drag a library component; the code panel empties then fills accordingly | P2 | §5/§6/§8 | Swap and remove scenario tests | Adopt [D] |
| **R15** | If code sync is not possible for a case, tell the user and say what to do manually | P2 | §5/§6/§8 | Error catalogue coverage test | Adopt [D] |
| **R16** | Custom builder: blank page; user adds components/layouts and writes code themselves | P2, E1 Q31 | §5/§6/§8 | Blank-start portfolio published | Adopt [D] |
| **R17** | Templates ship with pre-written code: typography, motion/animation and UX laws; the user only supplies content | P2, E1 Q31 | §1/§3 | Gates enforce UX rules; no hard-coded styles | Adopt [D] |
| **R18** | Image slots hold images without affecting code | P2 | §7/§12 | Replacing an image changes no code file | Adopt [D] |
| **R19** | Be truthful; try every route to make it possible | P2, P5 | §1/§3 | Every unproven claim labelled | Preserve / flag open [D/A] |
| **R20** | Visual builder: users edit layout and choose inputs; code is generated automatically and is ready to edit with few changes | E1 Q31 | §5/§6/§8 | Code panel always matches canvas | Adopt [D] |
| **R21** | Use free APIs and a free online code editor/compiler with preview where possible (Monaco as example) | E1 Q31, Q34 | §5/§6/§8 | Editor and preview run with no paid service | Adopt [D] |
| **R22** | Version history, restore points, revision comparison | E1 Q35 (option B) | §6/§10 | Restore and compare scenarios | Adopt [D] |
| **R23** | Next-round topics: responsive behaviour, components, code compatibility, security isolation, preview, publishing | E1 | §10/§15 | See each section | Adopt [D] |
| **R24** | Target-state description: how it is built, engineered, principles, methodology, architecture, flow, mechanism, how things combine | P3 | §1/§3 | — | Adopt [D] |
| **R25** | Appreciated by developer users and tech leads; include things you missed | P4 | §1/§3 | Evaluation walk-through (§28.6) | Adopt [D] |
| **R26** | Hybrid of both approaches with build guidance and everything a blueprint needs | P5 | §1/§3 | — | Adopt [D] |
| **R27** | Priority-first writing so an interruption doesn't hurt | P5 | §1/§3 | — | Preserve / flag open [D/A] |
| **R28** | Linear snapshots; no CLI in v1; local folder in v1; all browsers; timeline flexible | P5 | §6/§10 | — | Adopt [D] |
| **R29** | Public URL of the form kadmeion.vercel.app// when public is enabled; best free alternative if not good | P5 | §9 | Public/unlisted/private scenarios | Adopt [D] |
| **R30** | Cost ≤ ₹1,000 (target ₹0); open-source only; no paid APIs | K | §17 | Cost table | Adopt [D] |
| **R31** | The demo must survive loss of any cloud free tier | K | §10/§15 | Offline demo rehearsal | Adopt [D] |
| **R32** | Tagline *Build · Showcase · Evolve*; app name Kadmeion | P1 | §1/§3 | — | Adopt [D] |
| **R33** | Do not claim anything is implemented | P1 | §1/§3 | — | Preserve / flag open [D/A] |
Architect additions **R34–R47** are fully specified in §3 with explicit [C] provenance; the original 33 IDs were not renumbered.

## Appendix D. I1–I24 invariant and E01–E30 error-code crosswalk
**Interpretation correction:** draft validity, publication eligibility, source edit buffering and actual infrastructure behavior are four distinct states. Each invariant is a target requiring test evidence [S], **not an achieved guarantee**. An untrusted script cannot be declared safe merely because it passed a static linter.
### D.1. Source invariants — namespace `HYB:I`
| ID | Original invariant | Original enforcement | Original test | Final reconciliation |
|---|---|---|---|---|
| HYB:I1 | No action loses user content | Stash on remove/swap/layout change; Unplaced tray | Property test over random action sequences | Adopt as tested target [S] |
| HYB:I2 | Every state is restorable | Snapshot per action; append-only history | Restore-after-each-step test | Revisions may be pruned under disclosed quotas and deletion policy |
| HYB:I3 | Preview output equals published output | One assembly and compile path | Visual and DOM parity test | Same frozen revision and deterministic renderer; dynamic code parity not guaranteed |
| HYB:I4 | Broken code cannot be published | Compile + smoke load + gates | Seeded-fault tests | Block unsafe builds on validated pathways; test adversarial bypasses |
| HYB:I5 | Library changes never alter a saved project | Version pinning; opt-in upgrades | "Old project opens identically" test after each library release | Adopt as tested target [S] |
| HYB:I6 | One slot's failure never blanks another | Error boundary per slot; contained boxes | Fault injection per slot | Adopt as tested target [S] |
| HYB:I7 | Slot code cannot escape its box | Layout owns the grid; contain; scoped CSS | CSS leak tests | CSS containment alone not a security boundary |
| HYB:I8 | Only fitting components enter a slot | Manifest check in precheck and canvas | Drop matrix (every component × every slot) | Adopt as tested target [S] |
| HYB:I9 | Files the editor writes are always schema-valid | Validation on every operation; migrations tested | Schema fuzzing; migration round-trip | Committed structured files only; invalid buffered drafts permitted |
| HYB:I10 | Destructive actions need confirmation | Confirmation token required for S2 replace | S2 replace without token is rejected | Confirm destructive custom-source overwrite, not routine reversible removal |
| HYB:I11 | A required slot cannot be empty at publish | Validate stage | Publish test with each required slot removed | Adopt as tested target [S] |
| HYB:I12 | User code runs only inside the sandbox | Separate run-origin; CSP sandbox | Isolation tests | Custom code disabled publicly until cross-origin test |
| HYB:I13 | Unsupported source is never silently modified | Overrides and islands are opaque | Golden test: bytes in = bytes out | Adopt as tested target [S] |
| HYB:I14 | The editor writes only closed-grammar files, and the code files only when the user types | File-kind table (§10.2) | Static check + write-path audit test | User-owned code changed only on explicit edit; generated views regenerate |
| HYB:I15 | The editor never writes into an invalid file | Grammar Guard (§17) | Fuzzed inputs never produce a write | Adopt as tested target [S] |
| HYB:I16 | An operation changes only the lines it should | Minimal text edits | Golden-diff tests (SB1) | Byte-for-byte unchanged spans requires SB1; block otherwise |
| HYB:I17 | Public pages never depend on the database | Pointer + release store | Stop the database; public URL still serves | Backend-independent serving needs delivery bridge SP2 |
| HYB:I18 | Builds are deterministic | Sorted output, fixed timestamps, no randomness | Build twice, compare hash; same snapshot → same hash | Hash is environment-scoped unless SP5 proves cross-runtime parity |
| HYB:I19 | Releases are immutable; rollback is a pointer switch | Hashed file names; pointer is the only mutable record | Roll back and compare bytes | Adopt as tested target [S] |
| HYB:I20 | The pointer switches last and atomically | Pipeline order (§21.1) | Fault injection at every step: previous release stays live | Atomic pointer and cache invalidation depend on host SP2 |
| HYB:I21 | One writer per project at a time | Locks (§16.8) | Two-tab test | Concurrency conflicts preserved; no blind overwrite |
| HYB:I22 | History is append-only | Restore creates a new snapshot | Check no snapshot is ever deleted by restore | Retention exception for user deletion after 15 days |
| HYB:I23 | Every script on a public page is on the trusted hash list | Server re-check (§11.4) | Upload a release with an unlisted script → rejected | Static HTML sanitization and scripts trusted by hash; independent security lab |
| HYB:I24 | Public pages make no third-party requests | CSP + self-hosted assets | Crawl the sample portfolios; zero external requests | Self-host assets objective, CSP scoped to allowed exceptions |
### D.2. Source errors — namespace `HYB:E`
The original wording is preserved as a candidate [A], not automatically shipped strings. Each error must include action text, source location (where relevant), recovery options, and an automated trigger test.
| ID | Trigger | Source message | Action / recovery | Final status |
|---|---|---|---|---|
| HYB:E01 | Dropped component doesn't fit | "This slot takes headings. Try a heading component." | Drop refused, nothing changed | Adopt; fault-inject and verify [S] |
| HYB:E02 | Replace over edited code | "This slot has your custom code…" | Keep as component / Replace / Cancel | Adopt; fault-inject and verify [S] |
| HYB:E03 | Compile error in a slot | "Line 12 in Title.tsx: unexpected token." | Last good preview kept; reset to library | Adopt; fault-inject and verify [S] |
| HYB:E04 | Runtime error in a slot | "This section hit an error and was paused." | Rest of page works; fix or reset | Adopt; fault-inject and verify [S] |
| HYB:E05 | Preview stopped responding | "Preview restarted from your last working version." | Automatic | Adopt; fault-inject and verify [S] |
| HYB:E06 | Required slot empty at publish | "The hero title is empty." | Publish blocked; jump to slot | Adopt; fault-inject and verify [S] |
| HYB:E07 | Missing alt text | "This image needs a description (or mark it decorative)." | Publish blocked; jump | Adopt; fault-inject and verify [S] |
| HYB:E08 | Performance budget exceeded | "Page script is 210 KB; limit is 150 KB. Biggest: …" | Publish blocked; suggestion | Numeric sample is illustrative [A] — choose tested budget |
| HYB:E09 | Contrast below threshold | "Text on this button is hard to read (3.1:1; needs 4.5:1)." | Publish blocked; suggested colour | Adopt; fault-inject and verify [S] |
| HYB:E10 | Invalid or unsafe link | "This link isn't a valid web address." | Publish blocked | Adopt; fault-inject and verify [S] |
| HYB:E11 | Storage unavailable or full | "Your work isn't being saved in this browser." | Export zip; free space; switch store | Adopt; fault-inject and verify [S] |
| HYB:E12 | Upgrade conflict | "A new version exists and you have custom edits." | Keep mine / take new / compare | Adopt; fault-inject and verify [S] |
| HYB:E13 | Content over limit | "This title has 112 characters; the component shows 80." | Kept in full; warn; edit or choose another component | Adopt; fault-inject and verify [S] |
| HYB:E14 | Reviewer link expired | "This link has expired." (to the reviewer) | Owner makes a new link | Adopt; fault-inject and verify [S] |
| HYB:E15 | Verify mismatch after publish | "The live page didn't match, so we restored the previous version." | Automatic revert | Do not assert automatically reverted without host proof |
| HYB:E16 | Project migration failed | "We couldn't upgrade this project. Your original is untouched." | Open read-only; export; report | Adopt; fault-inject and verify [S] |
| HYB:E17 | Unsupported or oversized image | "Use a JPG, PNG, WebP or SVG under 8 MB." | Re-upload | SVG requires sanitization, not unconditional acceptance |
| HYB:E18 | Dependency not allowed | "This package isn't on the approved list: …" | Remove import or use approved one | Adopt; fault-inject and verify [S] |
| HYB:E19 | Invalid syntax in a project file | "Line 12 of home.page.jsonc is missing a comma." | Fix in place / Restore last good | Adopt; fault-inject and verify [S] |
| HYB:E20 | Invalid schema | "size must be one of sm, md, lg, xl." | Fix in place / Restore | Adopt; fault-inject and verify [S] |
| HYB:E21 | Invalid reference | "Component title-wow isn't in your library." | Pick replacement / Remove | Adopt; fault-inject and verify [S] |
| HYB:E22 | File changed outside the editor | "This file changed outside Kadmeion." | Reload / Keep mine / Compare | Adopt; fault-inject and verify [S] |
| HYB:E23 | Local folder unreachable | "Can't reach your folder. Your work is safe in this browser." | Re-grant / Export / Continue | Adopt; fault-inject and verify [S] |
| HYB:E24 | Sync conflict between devices | "Your other device changed this too." | Save mine as copy / Open other | Adopt; fault-inject and verify [S] |
| HYB:E25 | Browser may erase stored data (Safari) | "This browser may clear saved data after a week away. Turn on cloud sync or export." | Offer sync / export | Safari eviction warning conditional on browser/storage mode |
| HYB:E26 | Pre-render failed | "Search engines may see an empty page. We published a fallback." | Shown in gate report as degraded | Do not publish degraded SEO by default; block or explicit manual override after separate decision |
| HYB:E27 | Portfolio URL invalid or taken | "That address is taken. Try subhash-dev." | Suggestions | Adopt; fault-inject and verify [S] |
| HYB:E28 | Pointer switch failed | "Publishing didn't complete; your previous version is still live." | Automatic; retry | Adopt; fault-inject and verify [S] |
| HYB:E29 | Custom script held back | "Your custom script was published as a static page (see Details)." | Info; link to docs | Holding back scripts must not silently alter expected user functionality |
| HYB:E30 | Import rejected | "This zip has files we don't accept (list)." | Show list; nothing imported | Adopt; fault-inject and verify [S] |
### D.3. Additional errors without repurposing E01–E30
| ID | Trigger | User-facing action | Test |
|---|---|---|---|
| E31 [C] | Unauthorized cross-owner asset/project | Denied; no preview of private resource | Two-account RLS and direct Storage URL attack |
| E32 [C] | Browser permission revoked while folder open | Keep local recovery copy; reselect folder or export | Permission revoke during write |
| E33 [C] | Third-party static host or CDN unavailable | Show local site/export and current live uncertainty | Provider failure rehearsal |
| E34 [C] | Failed publication verification on one edge/cache | Do not claim success; preserve preceding release pointer | Inject stale cache and partial deployment |
| E35 [C] | Quota exceeded during snapshot commit | Keep pending content and allow export; no fake “Saved” | Storage quota fault |
| E36 [C] | Custom code attempts blocked capability or origin escape | Disable execution; show sanitized violation and safe fallback | Sandbox adversarial suite |

## Appendix E. All source risk, flow and guarantee inventories
**ID collision rule:** `HYB:F01` means a failure/premortem risk; `SPEC-A:F1` means an editor flow; `T3:G1` means a target-state guarantee. These namespaces are intentional and ensure no silent conflation.
### E.1. Hybrid F01–F28 premortem ledger
| ID | Original failure story | Original prevention/escape | Final disposition |
|---|---|---|---|
| HYB:F01 | Scope overload. Eight layouts, 35 variants, three levels of custom work, folder mode, all browsers — never finished | Phase order by risk; vertical slice first; cut lines (§30.6); layouts L6–L8 and presets come after the engine is proven; fallback Ship fewer layouts; cut order in §30.6 | §16 and §14 |
| HYB:F02 | Canvas library doesn't fit (slots, irregular shapes, updates) | Spike S1; pin the version; keep the project format independent of the library; fallback Thin custom drop-slot layer | §16 and §14 |
| HYB:F03 | In-browser compile unreliable | Spike S2; precompiled library; cache; fallback Per-file transform + import map; limit overrides to JSX/CSS | §16 and §14 |
| HYB:F04 | Content lost in a swap or layout change | Content separate from code; stash; Unplaced tray; property tests; fallback Stop feature work until fixed | §16 and §5 |
| HYB:F05 | Edited code destroyed | Confirmation token (I10); keep-as-component; fallback Disable swap on S2 | §16 and §5 |
| HYB:F06 | Minimal-diff editing mangles files (comments, order, indentation) | Spike SB1; golden diffs; fallback Custom patcher; or no comments in editor-written files | §16 and §6 |
| HYB:F07 | Grammar Guard false-VALID lets a bad file through | Strict schema; fuzzing (SB2); fallback Stricter schema; refuse ambiguous files | §16 and §6 |
| HYB:F08 | Format frozen too early and later painful | ADR-001; versioned format; migration tests; sample corpus from day one; fallback Migration tool; version bump | §16 and §6 |
| HYB:F09 | Pre-render fails → pages look empty to search | Spike SP5; fallback server function; fallback Client-render shell + degraded SEO label | §16 and §9 |
| HYB:F10 | Run-origin isolation fails or is bypassed | Spike SP1; CSP sandbox header; separate origin; custom JS off until proven (H19); fallback Keep custom JS off permanently (static only) | §16 and §14 |
| HYB:F11 | Hosting terms or free limits change (Hobby is non-commercial; limits could tighten) | Stay non-commercial; ReleaseStore interface; static export; operations doc; fallback Move to another free static host (Cloudflare Pages [V] free static requests); GitHub Pages export | §16 and §9 |
| HYB:F12 | Database pauses after inactivity (Free tier pauses after a week [V]) | I17: public pages need no database; keep-alive not needed; a restore button; fallback Resume project; or run release-store-only | §16 and §9 |
| HYB:F13 | kadmeion name unavailable on the free subdomain | Check early [S]; name is configurable; fallback Different project name; or add custom domain later | §16 and §9 |
| HYB:F14 | Safari/other browsers erase local data | Cloud sync; export reminders; persistent storage request; fallback Mandatory-sync prompt on Safari | §16 and §10 |
| HYB:F15 | "All browsers" overpromised; folder mode missing on Firefox/Safari | Tier table (§22.3); equal fallbacks; tests per engine; fallback Clear first-run guidance; zip workflow | §16 and §10 |
| HYB:F16 | Templates look generic | Two layouts excellent before scaling; design review at phase 2; distinct themes; fallback Invest in typography/motion; reduce count | §16 and §14 |
| HYB:F17 | Library bigger than planned | Parameterised variants; size budget; ~16 files for ~35 variants; fallback Cut variants, not quality | §16 and §14 |
| HYB:F18 | Mobile editing is poor | Tier 3 defined as content+preview+publish; tap-to-place; SP4; fallback Mobile = read/preview + simple edits | §16 and §10 |
| HYB:F19 | Monaco heavy or unsupported on some browsers | Lazy-load; SP4; text-area fallback; fallback Simpler editor for overrides | §16 and §10 |
| HYB:F20 | Determinism differs across environments | Verify within one environment; document; fallback Promise per-environment verification only | §16 and §6 |
| HYB:F21 | Abuse: phishing/impersonation under the domain | No forms; reserved names; report; pointer disable; fallback Kill switch; stricter signup | §16 and §9 |
| HYB:F22 | Users confused by files vs visual | Files hidden by default (H1); one editor, not modes; fallback Hide Advanced entirely for beginners | §16 and §14 |
| HYB:F23 | Accessibility gate false positives frustrate users | Warn vs block split; clear explanations; override for warnings; fallback Tune thresholds with evidence | §16 and §14 |
| HYB:F24 | One developer, long project → burnout or drift | Flexible timeline (H, user); phase-end demos; the cut order; docs as you go; fallback Reduce scope, never quality gates | §16 and §14 |
| HYB:F25 | Licence mistakes (fonts, images, libraries) | Record at adoption; licence script; fallback Replace the asset | §16 and §14 |
| HYB:F26 | Reviewer links need a server and the free tier disappears | Tokens in the release store, not the DB; short expiries; fallback Static "private build" zip for reviewers | §16 and §9 |
| HYB:F27 | Wireframe interpretation wrong (H21 sections vs single-screen templates) | State H21 explicitly; ask early; model supports both; fallback One section per template; no change to engine | §16 and §14 |
| HYB:F28 | Reading the "hybrid" as too complex (two architectures at once) | One core, five contracts; §4 explains the combination; ADRs; fallback Cut Advanced (files view) from first demo | §16 and §14 |
### E.2. Source-specific guarantee/flow identifiers and disposition
| Namespace | Original ID range | Meaning | Final coverage / caveat |
|---|---|---|---|
| SPEC-A | I1–I13 | Safety invariant | §13; mapped to HYB:I1–I13; gaps reconciled in D.1 |
| SPEC-A | E01–E18 | Error catalogue | §13 + HYB:E01–E18; exact messages appendix D |
| SPEC-A | F1–F10 | Editor flow diagrams/states | §5, §6, §12; source heading matrix G |
| SPEC-A | R1–R18 | Premortem risk register | §16; distinct from requirements R01–R47 |
| SPEC-A | J1–J6 | User journeys | §12/§14 |
| B | FB1–FB9 | Files-first end-to-end flows | §6, §10, §12 |
| T3 | G1–G10 | Ten quality guarantees | §13/§14; narrowed to testable targets |
| T1 | R1–R11 | Early owner slot requirements | §3 and §5; aliases only, not original hybrid R IDs |
| T3 | L0–L6 | Layer names | §4 |
| HYB | L1–L8 | Template section layouts | §7 |
**Retention vs reversibility:** `HYB:I2/I22` and `T3:G4` mean reversible ordinary editor operations within retained history; **not** reversal of permanent deletion, legal takedown, expired records, provider faults or external visitor actions. This prevents a logically impossible interpretation.

## Appendix F. S/SB/SP spike register, stop rules and current evidence
Reproduced from Hybrid §33.1; original numeric thresholds are **proposed acceptance baselines [A]**, not performance measurements. A [V] browser/library fact does not prove the Kadmeion integration [S].
| ID | Experiment / question | Proposed pass criterion | Fallback | Gate | Status |
|---|---|---|---|---|---|
| S1 | Does the canvas library (Puck) handle ~6 slots incl. irregular shapes, drag, delete, swap, round-trip? | All four actions work; data round-trips unchanged | Thin custom drop-slot layer | Phase 2 | [S] Not run |
| S2 | Can per-slot source compile and preview in a sandboxed iframe in time? | Typical edit previews < ~300 ms; error leaves last-good and other slots intact | Per-file transform + import map | Phase 5 | [S] Not run |
| S3 | Does the swap engine keep content and recover edited code? | 100 random sequences never lose content | Narrow overrides to simple JSX/CSS | Phase 3 | [S] Not run |
| S4 | Static publish and pointer rollback produce byte-identical output? | Live URL works; rollback restores identical bytes | Client-render bundle + pre-rendered meta | Phase 6 | [S] Not run |
| S5 | Is user code isolated? | Cannot read app storage or cookies; CSP blocks loads | Remove custom JS from published sites | Phase 5, 6 | [S] Not run |
| S6 | Does the image pipeline work in the browser? | Resize, compress, focal crop, mask work; alt enforced | Size limits + manual crop | Phase 4 | [S] Not run |
| S7 | Does a multi-file Monaco workspace behave? | File tree, per-file models, read-only files, markers | Single-file editor per slot | Phase 5 | [S] Not run |
| SB1 | Minimal-diff edits keep comments, key order, indentation? | Unchanged text byte-identical outside edit; 100 operations | Custom patcher (a jsonc-patch style library exists [V]), or no comments | Phase 2 | [S] Not run |
| SB2 | Grammar Guard handles all six states; fuzz never false-VALID? | All states reproduced; no write to invalid files | Stricter schema | Phase 3 | [S] Not run |
| SB3 | Linear content-addressed snapshots at size/speed? | 1,000 operations; restore and diff within targets | Simplify retention | Phase 3 | [S] Not run |
| SB4 | Same build hash browser vs Node? | Identical repeatedly | Verify within one environment | Phase 6 | [S] Not run |
| SB5 | Provenance attributes + source maps give reliable "Reveal in source"? | Click lands on right file/line | File-level reveal | Phase 9 | [S] Not run |
| SB6 | Local-folder adapter reads, writes, detects external change? | Edits appear within seconds; survive reload | Remove from v1; keep zip | Phase 7 | [S] Not run |
| SB7 | How does browser storage persist or get evicted? | Documented per browser; recovery tested | Stronger export/sync prompts | Phase 7 | [S] Not run |
| SP1 | Public serving + run-origin isolation | Sandboxed user script on run-origin can't touch app origin; CSP report clean; path-based public URL works | Custom JS stays off (H19) | Phase 6 | [S] Not run |
| SP2 | Platform choice: database vs release-store-only; Vercel Hobby fair-use for hosting others' content; Blob limits | Written decision + limits table | Release-store-only; static export | Phase 6 | [S] Not run |
| SP3 | Browser matrix: folder import without the directory picker; storage; editor on each engine | Table of what works on Chromium/Firefox/WebKit | Zip-only flows | Phase 7 | [S] Not run |
| SP4 | Phone editing feasibility incl. Monaco | Tap-to-place + content editing work on two phones; Monaco works or fallback set | Plain text area; read-only code | Phase 4 | [S] Not run |
| SP5 | Pre-render to static HTML in the browser | Same HTML as server render; passes axe | Server function; degraded-SEO shell | Phase 6 | [S] Not run |
Additional spikes [C] that resolve document conflicts, on top of the stable original IDs:
| ID | Question and pass criteria | Fallback |
|---|---|---|
| SP6 | Supabase Auth email flow, Google optional, abusive-signup throttling, 2-user project/RLS and asset policies; deny all cross-user actions | Delay public signup; local-only editor/export demonstration |
| SP7 | Supabase Edge Functions CPU/GET HTML limitations plus delivery bridge; prove origin routes, redirects, cache invalidation and direct asset URLs | Static export published manually through approved host |
| SP8 | Cloud disappears: block all network in controlled demo; reopen saved project and exported site, show durable last-saved state | Export-only recovery; revisit IndexedDB pressure/adapter |
| SP9 | Preview/import security adversarial tests: top-navigation, cookies, storage, iframe flags, postMessage, SVG and script URLs | Disable custom JS and unsafe embeds, trusted components only |
| SP10 | Check desired vercel.app name, terms/UGC risk, URL claiming and moderation; record written host decision | Alternate hostname or user-export hosting; no false URL promise |
| SP11 | Compare Puck with tiny custom canvas on 8 layouts, keyboard and mobile, custom slot variants | Custom bounded slot adapter |
| SP12 | Prove exact JSONC minimal diffs and comment loss scenarios against fuzz corpus | Remove comments from editor-written format, keep files stable as canonical JSON |
**Stop rule:** Any demonstrated cross-tenant access, sandbox escape, corrupted user source, broken restore, or untraceable publish mismatch blocks implementation/publishing of that capability until fixed and regression-tested. **Scope-cut rule:** trim preset variety, animated variants, advanced adapters and optional AI before eliminating export, recovery or security isolation.

## Appendix G. Exhaustive source-heading coverage matrix (second pass)
The rows below cover every Markdown heading in each unique source with exact original line location. `Included` = direct section; `Merged` = cross-source consolidation; `Deferred v1` = considered, intentionally postponed; `Dropped v1` = explicitly excluded with reason. Each source heading appears exactly once. A heading mapping is evidence of review, not proof that every sentence was copied; detailed IDs live in Appendices B–F and I.
| Source:line | Original heading (all levels) | Final location | Status |
|---|---|---|---|
| T1:1 | Kadmeion Portfolio Builder: Task 1 — Recommendation, Approach and Premortem | §16 / App. E | Included |
| T1:5 | 0. The verdict, up front | §2 / App. B | Included |
| T1:19 | 1. Requirements as I understand them | §1–§20 (cross-cutting) | Included |
| T1:41 | 2. The decision everything depends on: what is the source of truth? | §2 / App. B | Included |
| T1:53 | 3. The model: Section → Layout → Slot → Block → Props | §5 | Included |
| T1:97 | 4. The mechanism: how the visual board and the code view stay in step | §1–§20 (cross-cutting) | Included |
| T1:99 | 4.1 The page document | §1–§20 (cross-cutting) | Merged |
| T1:120 | 4.2 The generator | §1–§20 (cross-cutting) | Merged |
| T1:124 | 4.3 Your delete-and-drop scenario, step by step | §5 | Merged |
| T1:148 | 4.4 “Map the component’s code into that place”: usage versus implementation | §1–§20 (cross-cutting) | Merged |
| T1:157 | 4.5 Three code zones | §1–§20 (cross-cutting) | Merged |
| T1:165 | 4.5.1 Why the Content zone is the safe two-way channel | §1–§20 (cross-cutting) | Merged |
| T1:169 | 4.6 When a sync cannot happen: the five states | §5 | Merged |
| T1:183 | 4.7 What happens when a swap affects custom code | §5 | Merged |
| T1:187 | 5. The three modes, and how users move between them | §1–§20 (cross-cutting) | Included |
| T1:208 | 6. Architecture and stack | §4 | Included |
| T1:224 | 6.1 Build versus adopt for the canvas | §4 | Merged |
| T1:244 | 6.2 Security essentials | §8 | Merged |
| T1:253 | 7. Keeping the UI/UX laws true when users add their own content | §12 | Included |
| T1:276 | 8. Images, media and fonts | §7 | Included |
| T1:286 | 9. Engineering roadmap with exit criteria | §15 / App. F | Included |
| T1:304 | 10. Premortem | §16 / App. E | Included |
| T1:327 | 11. Things your requirements do not mention yet | §1–§20 (cross-cutting) | Included |
| T1:358 | 12. Decisions I made on your behalf, and what I need from you | §18 / App. H | Included |
| T2:1 | Kadmeion Portfolio Builder: Task 2 — The Other Perspective (Project-First, Contract-Driven) | §2 / App. B | Included |
| T2:5 | 0. How this perspective differs from Task 1 | §2 / App. B | Included |
| T2:25 | 1. The core idea: one write path, many lenses | §1 | Included |
| T2:51 | 2. What a Kadmeion portfolio is made of | §1–§20 (cross-cutting) | Included |
| T2:93 | 3. Contracts: the component protocol | §1–§20 (cross-cutting) | Included |
| T2:115 | 4. The lenses in detail | §1–§20 (cross-cutting) | Included |
| T2:133 | 5. Principles | §1–§20 (cross-cutting) | Included |
| T2:151 | 6. Methodology: how a strong team would build it | §15 / App. F | Included |
| T2:163 | 7. Architecture | §4 | Included |
| T2:192 | 8. Mechanisms for the hard parts | §1–§20 (cross-cutting) | Included |
| T2:209 | 9. What developers and tech leads actually notice | §1–§20 (cross-cutting) | Included |
| T2:243 | 10. Honest trade-offs, and the staging that manages them | §1–§20 (cross-cutting) | Included |
| T2:265 | 11. Premortem specific to this perspective | §16 / App. E | Included |
| T2:278 | 12. More things not yet mentioned | §1–§20 (cross-cutting) | Included |
| T2:309 | 13. How this connects to Task 3 | §1–§20 (cross-cutting) | Included |
| T3:1 | Kadmeion Portfolio Builder: Task 3 — The Reference Version (Specified as a Finished, Working System) | §1–§20 (cross-cutting) | Included |
| T3:5 | 0. How to read this document | §0 | Included |
| T3:11 | 1. What “without any flaw” means here: ten guarantees | §1–§20 (cross-cutting) | Included |
| T3:39 | 2. The finished product on one page | §1 | Included |
| T3:60 | 3. Principles | §1–§20 (cross-cutting) | Included |
| T3:81 | 4. Architecture | §4 | Included |
| T3:83 | 4.1 Layers (dependencies point downward only) | §4 | Merged |
| T3:95 | 4.2 Code layout (one repository) | §4 | Merged |
| T3:108 | 4.3 Data model | §6 | Merged |
| T3:121 | 4.4 Technology choices | §4 | Merged |
| T3:138 | 5. The flows | §1–§20 (cross-cutting) | Included |
| T3:142 | 5.1 Editing flows | §1–§20 (cross-cutting) | Merged |
| T3:159 | 5.2 Lifecycle flows | §1–§20 (cross-cutting) | Merged |
| T3:170 | 5.3 One story, end to end | §1–§20 (cross-cutting) | Merged |
| T3:183 | 6. The mechanisms: how many things become one, and why it works | §1–§20 (cross-cutting) | Included |
| T3:185 | 6.1 Seven fusions | §1–§20 (cross-cutting) | Merged |
| T3:197 | 6.2 The freedom ladder: guarantees degrade gracefully and visibly | §1–§20 (cross-cutting) | Merged |
| T3:210 | 6.3 State machines | §1–§20 (cross-cutting) | Merged |
| T3:233 | 6.4 The operation catalogue | §7 | Merged |
| T3:253 | 6.5 The rendering pipeline (editor and published site share it) | §1–§20 (cross-cutting) | Merged |
| T3:269 | 6.6 Sandbox and trust model | §8 | Merged |
| T3:282 | 7. The quality system: how the guarantees are continuously proven | §14 | Included |
| T3:284 | 7.1 The test layers | §14 | Merged |
| T3:302 | 7.2 Production metrics | §14 | Merged |
| T3:317 | 7.3 Release controls | §9 | Merged |
| T3:321 | 7.4 The acceptance suite | §14 | Merged |
| T3:346 | 8. What the finished editor feels like | §1–§20 (cross-cutting) | Included |
| T3:361 | 9. Methodology: how it is built | §15 / App. F | Included |
| T3:374 | 10. Where this document supersedes Tasks 1 and 2 | §1–§20 (cross-cutting) | Included |
| T3:388 | 11. Build order | §15 / App. F | Included |
| T3:407 | 12. What remains hard, what cannot be promised, and what I need from you | §18 / App. H | Included |
| A:1 | Kadmeion Portfolio Editor — Target-State Specification | §1–§20 (cross-cutting) | Included |
| A:7 | 0. Document control | §0 | Included |
| A:9 | 0.1 What this document is | §0 | Merged |
| A:12 | 0.2 What it is not | §1 | Merged |
| A:16 | 0.3 The truth about "no flaw" | §0 | Merged |
| A:23 | 0.4 Evidence labels used throughout | §19 | Merged |
| A:31 | 0.5 Defaults adopted | §0 | Merged |
| A:34 | 0.6 If the chat is cut off | §0 | Merged |
| A:37 | 0.7 Glossary | §20 | Merged |
| A:57 | 1. Product definition | §1 | Included |
| A:59 | 1.1 The feature in one paragraph | §1 | Merged |
| A:62 | 1.2 Users and journeys | §1 | Merged |
| A:72 | 1.3 Modes: what each one can change | §1 | Merged |
| A:82 | 1.4 Scope boundary | §1 | Merged |
| A:93 | 1.5 What "successfully working" means | §1 | Merged |
| A:103 | 2. Principles | §1–§20 (cross-cutting) | Included |
| A:123 | 3. Methodology | §15 / App. F | Included |
| A:125 | 3.1 The approach in one line | §15 / App. F | Merged |
| A:128 | 3.2 Why this order | §15 / App. F | Merged |
| A:131 | 3.3 Spikes and their pass criteria | §15 / App. F | Merged |
| A:144 | 3.4 Definition of Ready (before building a feature) | §15 / App. F | Merged |
| A:149 | 3.5 Definition of Done (before calling a feature finished) | §14 | Merged |
| A:157 | 3.6 Decisions and change control | §15 / App. F | Merged |
| A:162 | 3.7 Review gates | §15 / App. F | Merged |
| A:167 | 4. Architecture | §4 | Included |
| A:169 | 4.1 System context | §4 | Merged |
| A:198 | 4.2 Layers and responsibilities | §4 | Merged |
| A:214 | 4.3 Data model | §6 | Merged |
| A:300 | 4.4 Slot types (first release) | §9 | Merged |
| A:322 | 4.5 Technology choices and their status | §12 | Merged |
| A:339 | 4.6 Module layout (suggested) | §4 | Merged |
| A:356 | 4.7 Key architectural patterns | §4 | Merged |
| A:364 | 5. How many things become one feature | §1–§20 (cross-cutting) | Included |
| A:366 | 5.1 The unifying idea | §1–§20 (cross-cutting) | Merged |
| A:393 | 5.2 The three modes are views, not products | §1–§20 (cross-cutting) | Merged |
| A:401 | 5.3 Assembly: how the pieces merge (step by step) | §1–§20 (cross-cutting) | Merged |
| A:433 | 5.4 What the user sees in the code panel | §1–§20 (cross-cutting) | Merged |
| A:439 | 5.5 Why this combination holds together | §1–§20 (cross-cutting) | Merged |
| A:446 | 5.6 How each recorded feature maps to a mechanism | §1–§20 (cross-cutting) | Merged |
| A:461 | 6. Core mechanisms | §1–§20 (cross-cutting) | Included |
| A:463 | 6.1 The action engine and the swap engine | §5 | Merged |
| A:502 | 6.2 Content binding and the stash | §5 | Merged |
| A:515 | 6.3 Slot code, overrides and islands | §5 | Merged |
| A:523 | 6.4 Theme tokens: portfolio-level typography, motion and UX rules | §7 | Merged |
| A:541 | 6.5 Responsive engine | §1–§20 (cross-cutting) | Merged |
| A:549 | 6.6 Compile and preview pipeline | §8 | Merged |
| A:560 | 6.7 Image pipeline | §7 | Merged |
| A:569 | 6.8 Versioning and history | §6 | Merged |
| A:577 | 6.9 Publishing pipeline and gates | §1–§20 (cross-cutting) | Merged |
| A:595 | 6.10 Component and layout lifecycle | §1–§20 (cross-cutting) | Merged |
| A:607 | 6.11 Custom builder | §1–§20 (cross-cutting) | Merged |
| A:615 | 6.12 Security model | §8 | Merged |
| A:630 | 7. Flow activity | §1–§20 (cross-cutting) | Included |
| A:632 | 7.1 F1 — First visit to a published portfolio (J1) | §1–§20 (cross-cutting) | Merged |
| A:644 | 7.2 F2 — Swap one component (pristine slot) | §5 | Merged |
| A:661 | 7.3 F3 — Swap over edited code (S2) | §5 | Merged |
| A:669 | 7.4 F4 — Edit slot code, hit an error, recover | §5 | Merged |
| A:678 | 7.5 F5 — Refresh or crash mid-edit | §1–§20 (cross-cutting) | Merged |
| A:683 | 7.6 F6 — Publish and roll back | §9 | Merged |
| A:689 | 7.7 F7 — Reviewer link | §1–§20 (cross-cutting) | Merged |
| A:696 | 7.8 F8 — Library upgrade | §1–§20 (cross-cutting) | Merged |
| A:703 | 7.9 F9 — Change layout | §1–§20 (cross-cutting) | Merged |
| A:710 | 7.10 F10 — Custom builder start | §1–§20 (cross-cutting) | Merged |
| A:717 | 7.11 State machines | §1–§20 (cross-cutting) | Merged |
| A:750 | 8. Functional guarantees | §1–§20 (cross-cutting) | Included |
| A:752 | 8.1 Invariants | §1–§20 (cross-cutting) | Merged |
| A:771 | 8.2 Errors and what the user sees | §1–§20 (cross-cutting) | Merged |
| A:795 | 8.3 Known limits (stated honestly) | §1–§20 (cross-cutting) | Merged |
| A:806 | 9. Quality system | §14 | Included |
| A:808 | 9.1 Test layers | §14 | Merged |
| A:823 | 9.2 Property testing of the swap engine | §5 | Merged |
| A:829 | 9.3 Library continuous checks | §14 | Merged |
| A:834 | 9.4 Publish gate thresholds | §9 | Merged |
| A:850 | 9.5 Usability testing | §14 | Merged |
| A:856 | 9.6 Measurement | §14 | Merged |
| A:861 | 10. Editor experience | §1–§20 (cross-cutting) | Included |
| A:863 | 10.1 Screen layout | §1–§20 (cross-cutting) | Merged |
| A:879 | 10.2 Interaction rules | §12 | Merged |
| A:888 | 10.3 Message design | §1–§20 (cross-cutting) | Merged |
| A:894 | 10.4 First run | §1–§20 (cross-cutting) | Merged |
| A:899 | 10.5 Editor responsiveness targets [A] | §1–§20 (cross-cutting) | Merged |
| A:909 | 11. Roadmap | §15 / App. F | Included |
| A:911 | 11.1 Choice of first layouts [A] | §15 / App. F | Merged |
| A:917 | 11.2 Library size for the first release [A] | §9 | Merged |
| A:920 | 11.3 Phases | §15 / App. F | Merged |
| A:936 | 11.4 Cut lines (what to drop first if time runs short) | §5 | Merged |
| A:945 | 11.5 Dependencies | §15 / App. F | Merged |
| A:950 | 12. Pre-mortem and post-mortem | §16 / App. E | Included |
| A:952 | 12.1 Pre-mortem: "it is the end of the project and the editor failed because…" | §16 / App. E | Merged |
| A:975 | 12.2 Success measures | §16 / App. E | Merged |
| A:987 | 12.3 Decision and kill rules (set now, apply later) | §2 / App. B | Merged |
| A:998 | 12.4 Post-mortem plan | §16 / App. E | Merged |
| A:1012 | 12.5 If the project succeeds, what had to be true | §16 / App. E | Merged |
| A:1021 | 13. Beyond the baseline: ways to get more from the design | §1–§20 (cross-cutting) | Included |
| A:1040 | 14. Assumptions, open decisions and unverified items | §1–§20 (cross-cutting) | Included |
| A:1042 | 14.1 Assumptions that change the plan if wrong [A] | §1–§20 (cross-cutting) | Merged |
| A:1056 | 14.2 Decisions I still need from you | §18 / App. H | Merged |
| A:1065 | 14.3 Unverified items to settle with spikes [S] | §1–§20 (cross-cutting) | Merged |
| A:1074 | 14.4 Verified facts used (checked 2026-11-12) | §1–§20 (cross-cutting) | Merged |
| A:1084 | 15. Appendices | §1–§20 (cross-cutting) | Included |
| A:1086 | Appendix A — Wireframe → slot map | §7 | Merged |
| A:1146 | Appendix B — Worked example: swap with content mapping | §5 | Merged |
| A:1153 | Appendix C — Worked example: swap over edited code | §5 | Merged |
| A:1160 | Appendix D — Definition of Done checklist for a new layout | §14 | Merged |
| A:1170 | Appendix E — Definition of Done checklist for a new component | §14 | Merged |
| A:1180 | Appendix F — Before starting P0 | §1–§20 (cross-cutting) | Merged |
| A:1190 | Appendix G — Sources for verified facts | §1–§20 (cross-cutting) | Merged |
| B:1 | Kadmeion Portfolio Editor — Perspective B: Files-First, Protocol-First | §2 / App. B | Included |
| B:7 | 0. Document control | §0 | Included |
| B:9 | 0.1 Purpose | §0 | Merged |
| B:12 | 0.2 The question it answers | §0 | Merged |
| B:15 | 0.3 Truth statement | §0 | Merged |
| B:20 | 0.4 Evidence labels | §19 | Merged |
| B:28 | 0.5 How to read this if the chat is cut off | §0 | Merged |
| B:31 | 0.6 Glossary additions (beyond Spec A) | §20 | Merged |
| B:47 | 1. Two perspectives compared | §1–§20 (cross-cutting) | Included |
| B:49 | 1.1 One-line summaries | §1–§20 (cross-cutting) | Merged |
| B:53 | 1.2 What each optimises | §1–§20 (cross-cutting) | Merged |
| B:68 | 1.3 The idea that makes B safe | §1–§20 (cross-cutting) | Merged |
| B:71 | 1.4 Honest comparison of what could go wrong | §1–§20 (cross-cutting) | Merged |
| B:79 | 1.5 Verdict (my recommendation) | §2 / App. B | Merged |
| B:89 | 2. Who must be impressed, and what they actually do | §1–§20 (cross-cutting) | Included |
| B:93 | 2.1 Developer users | §1–§20 (cross-cutting) | Merged |
| B:106 | 2.2 Tech leads | §1–§20 (cross-cutting) | Merged |
| B:124 | 3. Principles (Perspective B) | §2 / App. B | Included |
| B:147 | 4. The project model | §6 | Included |
| B:149 | 4.1 What a project is | §6 | Merged |
| B:173 | 4.2 Which files the editor may write | §6 | Merged |
| B:183 | 4.3 The closed grammar: format choice | §6 | Merged |
| B:194 | 4.4 Example files | §6 | Merged |
| B:244 | 4.5 Grammar rules (summary) | §6 | Merged |
| B:252 | 4.6 How this maps to Spec A's Document | §6 | Merged |
| B:269 | 5. Architecture | §4 | Included |
| B:271 | 5.1 One core, three shells | §4 | Merged |
| B:298 | 5.2 Five contracts: how many things become one | §4 | Merged |
| B:311 | 5.3 Layers | §4 | Merged |
| B:324 | 5.4 Data flow for any change | §4 | Merged |
| B:333 | 5.5 Storage adapters | §4 | Merged |
| B:341 | 5.6 Technology choices (additions to Spec A §4.5) | §4 | Merged |
| B:352 | 5.7 Architectural patterns | §4 | Merged |
| B:359 | 5.8 Module layout | §4 | Merged |
| B:374 | 6. The edit engine | §1–§20 (cross-cutting) | Included |
| B:376 | 6.1 Operations (Spec A's actions, now with file targets) | §1–§20 (cross-cutting) | Merged |
| B:390 | 6.2 Operation lifecycle | §6 | Merged |
| B:400 | 6.3 Minimal-diff guarantee | §14 | Merged |
| B:406 | 6.4 Grammar Guard and external edits | §6 | Merged |
| B:420 | 6.5 Intent over patches | §1–§20 (cross-cutting) | Merged |
| B:423 | 6.6 Atomic multi-file operations | §1–§20 (cross-cutting) | Merged |
| B:428 | 6.7 Formatting policy | §1–§20 (cross-cutting) | Merged |
| B:433 | 7. The Component Protocol | §1–§20 (cross-cutting) | Included |
| B:435 | 7.1 What it adds to Spec A's manifest | §1–§20 (cross-cutting) | Merged |
| B:447 | 7.2 Conformance suite (kad test component) | §14 | Merged |
| B:458 | 7.3 Capability model | §1–§20 (cross-cutting) | Merged |
| B:463 | 7.4 Authoring experience (a test of the whole design) | §14 | Merged |
| B:469 | 7.5 Registry and sharing | §1–§20 (cross-cutting) | Merged |
| B:473 | 7.6 Layout protocol | §1–§20 (cross-cutting) | Merged |
| B:476 | 7.7 Versioning and deprecation | §1–§20 (cross-cutting) | Merged |
| B:482 | 8. History, variants and sync | §6 | Included |
| B:484 | 8.1 History model | §6 | Merged |
| B:489 | 8.2 What gets recorded | §6 | Merged |
| B:495 | 8.3 Variants (branches): a feature developers will talk about | §6 | Deferred v1 |
| B:501 | 8.4 Compare | §2 / App. B | Merged |
| B:504 | 8.5 Backup and recovery | §6 | Merged |
| B:511 | 9. Build, delivery, performance, security and abuse | §17 | Included |
| B:513 | 9.1 Deterministic builds | §17 | Merged |
| B:519 | 9.2 Output model: fast by construction | §17 | Merged |
| B:523 | 9.3 Budgets as contract | §17 | Merged |
| B:526 | 9.4 Supply chain | §17 | Merged |
| B:532 | 9.5 Security additions (on top of Spec A §6.12) | §8 | Merged |
| B:540 | 9.6 Abuse and trust (often forgotten) | §17 | Merged |
| B:549 | 9.7 Observability | §17 | Merged |
| B:556 | 10. The developer-experience layer | §4 | Included |
| B:558 | 10.1 Provenance and "Reveal in source" | §6 | Merged |
| B:564 | 10.2 "Why is it like this?" | §4 | Merged |
| B:567 | 10.3 Command palette and keyboard-first design | §12 | Merged |
| B:572 | 10.4 Problems panel | §4 | Merged |
| B:575 | 10.5 Diff-first workflow | §4 | Merged |
| B:580 | 10.6 Command-line parity | §4 | Merged |
| B:596 | 10.7 Documentation as a product | §4 | Merged |
| B:602 | 10.8 Extensibility (minimal first) | §4 | Merged |
| B:610 | 10.9 Editor accessibility and internationalisation | §12 | Merged |
| B:615 | 10.10 Settings as files | §4 | Merged |
| B:620 | 11. Engineering governance and quality (what a tech lead looks for) | §14 | Included |
| B:622 | 11.1 Tech-lead scorecard: claim → evidence | §19 | Merged |
| B:638 | 11.2 Architecture decision records (ADRs) | §4 | Merged |
| B:654 | 11.3 Test strategy (additions to Spec A §9) | §14 | Merged |
| B:667 | 11.4 Targets | §14 | Merged |
| B:679 | 11.5 Stability and change management | §14 | Merged |
| B:684 | 11.6 Security process | §8 | Merged |
| B:687 | 11.7 Licensing and legal housekeeping | §17 | Merged |
| B:694 | 11.8 Maintainability rules | §14 | Merged |
| B:701 | 12. Flow activity (Perspective B) | §2 / App. B | Included |
| B:703 | 12.1 FB1 — A visual edit becomes a tiny diff | §2 / App. B | Merged |
| B:714 | 12.2 FB2 — Editing in VS Code while the editor is open (local folder mode) | §10 | Merged |
| B:721 | 12.3 FB3 — Break something on purpose | §0 | Merged |
| B:727 | 12.4 FB4 — Variants for different job applications | §2 / App. B | Merged |
| B:733 | 12.5 FB5 — Writing a new component | §2 / App. B | Merged |
| B:739 | 12.6 FB6 — Pipeline check and release verification | §19 | Merged |
| B:744 | 12.7 FB7 — A tech lead's 30-minute evaluation (the scripted "demo that must pass") | §14 | Merged |
| B:754 | 12.8 FB8 — Opening someone else's project (zip) | §10 | Merged |
| B:759 | 12.9 FB9 — Crash in the middle of a multi-file operation | §6 | Merged |
| B:764 | 12.10 State machines (additions) | §2 / App. B | Merged |
| B:779 | 13. Things you may have missed | §17 | Included |
| B:781 | 13.1 Product | §17 | Merged |
| B:794 | 13.2 Engineering | §17 | Merged |
| B:807 | 13.3 Trust and legal | §17 | Merged |
| B:817 | 13.4 Operations | §17 | Merged |
| B:826 | 13.5 People and process | §17 | Merged |
| HYB:1 | Kadmeion Portfolio Editor — Hybrid Blueprint (Master Document) | §1–§20 (cross-cutting) | Included |
| HYB:8 | 0. Reading guide and priority map | §0 | Included |
| HYB:26 | 1. Master summary | §1 | Included |
| HYB:28 | 1.1 What the editor is, in plain words | §1 | Merged |
| HYB:37 | 1.2 The five ideas that make it work | §1 | Merged |
| HYB:46 | 1.3 What the first release (v1) contains | §9 | Merged |
| HYB:60 | 1.4 Golden rules | §1 | Merged |
| HYB:74 | 2. Final decisions register | §1–§20 (cross-cutting) | Included |
| HYB:104 | 3. Requirement traceability | §3 / App. C | Included |
| HYB:146 | 4. Architecture at a glance | §4 | Included |
| HYB:148 | 4.1 System picture | §4 | Merged |
| HYB:169 | 4.2 Layers | §4 | Merged |
| HYB:183 | 4.3 The five contracts (open and versioned) | §4 | Merged |
| HYB:186 | 4.4 How many things become one | §4 | Merged |
| HYB:201 | 4.5 One core, thin shells | §4 | Merged |
| HYB:206 | 5. The core mechanism: how your slot idea works | §5 | Included |
| HYB:208 | 5.1 Your behaviours and what makes each one happen | §5 | Merged |
| HYB:221 | 5.2 Slot states | §5 | Merged |
| HYB:230 | 5.3 The swap, in plain steps | §5 | Merged |
| HYB:241 | 5.4 When automatic sync is not possible: what the user is told | §5 | Merged |
| HYB:255 | 6. Public portfolio URL and hosting | §9 | Included |
| HYB:257 | 6.1 Your idea, evaluated | §9 | Merged |
| HYB:263 | 6.2 URL scheme | §9 | Merged |
| HYB:275 | 6.3 Visibility (the "public portfolio enabled" switch) | §9 | Merged |
| HYB:284 | 6.4 How serving works (so public pages never depend on the database) | §9 | Merged |
| HYB:291 | 6.5 Isolating user code | §9 | Merged |
| HYB:300 | 6.6 Hosting facts and limits (checked 2026-11-12) | §9 | Merged |
| HYB:311 | 6.7 Other free options (if you ever want an alternative) | §9 | Merged |
| HYB:319 | 6.8 Acceptance checks for this section | §14 | Merged |
| HYB:328 | 7. What to build, in what order | §1–§20 (cross-cutting) | Included |
| HYB:352 | PART 2 — BUILD GUIDE | §1–§20 (cross-cutting) | Included |
| HYB:354 | 8. Technology stack and environment | §4 | Included |
| HYB:356 | 8.1 Choices | §4 | Merged |
| HYB:379 | 8.2 Your development machine | §4 | Merged |
| HYB:382 | 8.3 Cost (₹0 target) | §4 | Merged |
| HYB:391 | 8.4 Licence record | §17 | Merged |
| HYB:396 | 9. Repository and module layout | §4 | Included |
| HYB:398 | 9.1 Layout | §4 | Merged |
| HYB:428 | 9.2 Rules that keep it maintainable | §4 | Merged |
| HYB:434 | 9.3 Decision-record template | §7 | Merged |
| HYB:440 | 10. Project format and data model | §6 | Included |
| HYB:442 | 10.1 What a project looks like | §6 | Merged |
| HYB:462 | 10.2 Which files the editor may write by itself | §6 | Merged |
| HYB:468 | 10.3 Example files | §6 | Merged |
| HYB:525 | 10.4 Platform records (server side) | §6 | Merged |
| HYB:552 | 10.5 Rules of the fixed format | §6 | Merged |
| HYB:560 | 10.6 Slot types (v1) | §5 | Merged |
| HYB:579 | 10.7 Component manifest (v1 fields) | §6 | Merged |
| HYB:582 | 10.8 Layout manifest (v1 fields) | §6 | Merged |
| HYB:585 | 10.9 Operations | §6 | Merged |
| HYB:588 | 10.10 Versioning and migration | §6 | Merged |
| HYB:593 | 11. Platform services (accounts, sync, publishing) | §11 | Included |
| HYB:595 | 11.1 What the server does (and nothing more) | §11 | Merged |
| HYB:606 | 11.2 Endpoints (summary) | §11 | Merged |
| HYB:621 | 11.3 Sync rule (linear snapshots) | §11 | Merged |
| HYB:625 | 11.4 Server-side checks on every publish (never trust the browser's build) | §10 | Merged |
| HYB:633 | 11.5 Quotas (protect the free tiers) [A] | §11 | Merged |
| HYB:636 | 11.6 Data lifecycle | §11 | Merged |
| HYB:641 | 12. Layout catalogue | §7 | Included |
| HYB:645 | 12.1 Common rules for every layout | §7 | Merged |
| HYB:652 | 12.2 Header variants (from the wireframes' navigation rows) | §12 | Merged |
| HYB:660 | 12.3 Section layouts | §7 | Merged |
| HYB:747 | 12.4 Supporting sections (needed for a complete portfolio) [C] | §7 | Merged |
| HYB:757 | 12.5 Template presets (the 5–10 templates; v1 ships five) | §7 | Merged |
| HYB:768 | 12.6 The blank page (custom builder) — see §23 | §7 | Merged |
| HYB:772 | 13. Component catalogue | §7 | Included |
| HYB:797 | 14. Theme tokens, typography, motion and UX rules | §7 | Included |
| HYB:799 | 14.1 Token groups | §7 | Merged |
| HYB:809 | 14.2 Theme presets | §7 | Merged |
| HYB:812 | 14.3 Fonts | §7 | Merged |
| HYB:815 | 14.4 Motion rules | §12 | Merged |
| HYB:824 | 14.5 UX laws as enforceable rules | §12 | Merged |
| HYB:840 | 15. Images and assets | §1–§20 (cross-cutting) | Included |
| HYB:842 | 15.1 Pipeline | §1–§20 (cross-cutting) | Merged |
| HYB:852 | 15.2 Video and embeds [A] | §1–§20 (cross-cutting) | Merged |
| HYB:855 | 15.3 Sample assets | §1–§20 (cross-cutting) | Merged |
| HYB:860 | PART 3 — MECHANISMS (how each moving part works) | §1–§20 (cross-cutting) | Included |
| HYB:862 | 16. Operation engine and the swap | §5 | Included |
| HYB:864 | 16.1 The one pipeline every change goes through | §5 | Merged |
| HYB:877 | 16.2 Atomic commits | §5 | Merged |
| HYB:881 | 16.3 Slot states (from Spec A, kept) | §5 | Merged |
| HYB:889 | 16.4 Behaviours you asked for, made precise | §5 | Merged |
| HYB:899 | 16.5 Content moves with the user, not with the component | §5 | Merged |
| HYB:905 | 16.6 When a swap or sync is not possible (the guidance you asked for) | §5 | Merged |
| HYB:916 | 16.7 Undo and redo | §5 | Merged |
| HYB:920 | 16.8 Two tabs open | §5 | Merged |
| HYB:923 | 16.9 Operation catalogue (preconditions and risk) | §16 / App. E | Merged |
| HYB:940 | 17. Grammar Guard and external edits | §6 | Included |
| HYB:942 | 17.1 Purpose | §0 | Merged |
| HYB:945 | 17.2 File states | §6 | Merged |
| HYB:955 | 17.3 Rules | §6 | Merged |
| HYB:961 | 17.4 Three-way reconcile (CHANGED-UNDER-US) | §6 | Merged |
| HYB:964 | 17.5 Format preservation tests (spike SB1) | §15 / App. F | Merged |
| HYB:969 | 18. Source mode: overrides, islands and the code editor | §6 | Included |
| HYB:971 | 18.1 The code panel is a projection, not the source | §6 | Merged |
| HYB:980 | 18.2 Why whole-file overrides | §6 | Merged |
| HYB:983 | 18.3 Islands (user components) | §6 | Merged |
| HYB:988 | 18.4 Editing experience | §6 | Merged |
| HYB:994 | 18.5 Code rules (v1) | §6 | Merged |
| HYB:1002 | 19. Compile, preview and sandbox | §8 | Included |
| HYB:1004 | 19.1 Assemble → compile → preview | §8 | Merged |
| HYB:1009 | 19.2 Preview features | §8 | Merged |
| HYB:1020 | 19.3 Keeping the preview alive | §8 | Merged |
| HYB:1026 | 19.4 Preview = publish | §9 | Merged |
| HYB:1029 | 19.5 Source-to-slot error mapping | §5 | Merged |
| HYB:1034 | 20. Snapshots, restore and comparison | §1–§20 (cross-cutting) | Included |
| HYB:1036 | 20.1 Model (decision H5: linear) | §2 / App. B | Merged |
| HYB:1040 | 20.2 When snapshots are taken | §1–§20 (cross-cutting) | Merged |
| HYB:1049 | 20.3 Restore | §1–§20 (cross-cutting) | Merged |
| HYB:1052 | 20.4 Compare | §2 / App. B | Merged |
| HYB:1058 | 20.5 Retention and storage | §1–§20 (cross-cutting) | Merged |
| HYB:1061 | 20.6 Browser storage risks (honest) | §10 | Merged |
| HYB:1068 | 21. Publishing pipeline, gates, releases and rollback | §9 | Included |
| HYB:1070 | 21.1 Steps | §9 | Merged |
| HYB:1085 | 21.2 Gates | §9 | Merged |
| HYB:1095 | 21.3 Pre-rendering (spike SP5) | §15 / App. F | Merged |
| HYB:1098 | 21.4 Release, pointer, rollback | §9 | Merged |
| HYB:1103 | 21.5 Reviewer links (for tech leads and recruiters) | §9 | Merged |
| HYB:1107 | 21.6 SEO and sharing | §9 | Merged |
| HYB:1112 | 21.7 Static export (survives losing any host) | §9 | Merged |
| HYB:1117 | 22. Storage adapters, local folder, import/export and browser support | §10 | Included |
| HYB:1119 | 22.1 One adapter interface | §10 | Merged |
| HYB:1131 | 22.2 Local-folder mode (included in v1, as you decided) | §10 | Merged |
| HYB:1138 | 22.3 Browser support — the honest tier table (decision H8: "all browsers") | §10 | Merged |
| HYB:1153 | 22.4 Import and export | §10 | Merged |
| HYB:1162 | 22.5 One active store at a time | §10 | Merged |
| HYB:1167 | 23. The custom builder (blank page) | §1–§20 (cross-cutting) | Included |
| HYB:1169 | 23.1 What "start from a blank page" means here | §1–§20 (cross-cutting) | Merged |
| HYB:1178 | 23.2 Starter kit | §1–§20 (cross-cutting) | Merged |
| HYB:1181 | 23.3 Editor tools for custom work | §1–§20 (cross-cutting) | Merged |
| HYB:1184 | 23.4 What still applies on a blank page | §1–§20 (cross-cutting) | Merged |
| HYB:1190 | 23.5 Honest limits (v1) | §1–§20 (cross-cutting) | Merged |
| HYB:1198 | 23.6 How custom code is published safely | §1–§20 (cross-cutting) | Merged |
| HYB:1204 | 23.7 Promoting work | §1–§20 (cross-cutting) | Merged |
| HYB:1209 | 24. Security and abuse model | §17 | Included |
| HYB:1211 | 24.1 Threat table | §17 | Merged |
| HYB:1229 | 24.2 Headers | §17 | Merged |
| HYB:1236 | 24.3 Operator controls | §17 | Merged |
| HYB:1239 | 24.4 Security tests (see §27) | §8 | Merged |
| HYB:1244 | PART 4 — EXPERIENCE, QUALITY AND RISK | §16 / App. E | Included |
| HYB:1246 | 25. Editor UX and flows | §12 | Included |
| HYB:1248 | 25.1 Principles (decision H2: "easier user experience") | §2 / App. B | Merged |
| HYB:1256 | 25.2 Screen map | §12 | Merged |
| HYB:1269 | 25.3 The editor workbench | §12 | Merged |
| HYB:1287 | 25.4 Key flows | §12 | Merged |
| HYB:1304 | 25.5 Access and input methods | §12 | Merged |
| HYB:1310 | 25.6 Message design | §12 | Merged |
| HYB:1313 | 25.7 First-run and empty states | §12 | Merged |
| HYB:1318 | 25.8 Responsiveness targets (editor) [A — to be measured in spikes] | §12 | Merged |
| HYB:1330 | 26. Invariants and the error catalogue | §13 / App. D | Included |
| HYB:1332 | 26.1 Invariants (statements that must always be true) | §13 / App. D | Merged |
| HYB:1365 | 26.2 Error catalogue | §13 / App. D | Merged |
| HYB:1400 | 26.3 Coverage rule | §13 / App. D | Merged |
| HYB:1405 | 27. Quality system and tests | §14 | Included |
| HYB:1407 | 27.1 Test layers | §14 | Merged |
| HYB:1428 | 27.2 Definition of done (any work package) | §14 | Merged |
| HYB:1431 | 27.3 Continuous checks | §14 | Merged |
| HYB:1434 | 27.4 Sample corpus | §14 | Merged |
| HYB:1439 | 27.5 Release readiness checklist | §9 | Merged |
| HYB:1444 | 28. Developer and tech-lead quality | §14 | Included |
| HYB:1446 | 28.1 What earns respect from experienced engineers | §14 | Merged |
| HYB:1459 | 28.2 Developer-experience layer | §4 | Merged |
| HYB:1472 | 28.3 Component Protocol conformance suite | §14 | Merged |
| HYB:1486 | 28.4 Documentation set (part of the product) | §14 | Merged |
| HYB:1489 | 28.5 Tech-lead scorecard (the evidence a reviewer can check) | §19 | Merged |
| HYB:1503 | 28.6 Evaluation walk-through (a reviewer's 15 minutes) | §14 | Merged |
| HYB:1516 | 28.7 Licence and dependency hygiene | §17 | Merged |
| HYB:1519 | 28.8 The capstone demonstration (8 minutes) [A] | §14 | Merged |
| HYB:1529 | 29. Pre-mortem (imagine it failed — why?) | §16 / App. E | Included |
| HYB:1566 | 30. Post-mortem and success measures | §16 / App. E | Included |
| HYB:1568 | 30.1 When and how | §16 / App. E | Merged |
| HYB:1571 | 30.2 Success measures | §16 / App. E | Merged |
| HYB:1593 | 30.3 "Done" for v1 | §16 / App. E | Merged |
| HYB:1596 | 30.4 Phase retrospective template | §7 | Merged |
| HYB:1605 | 30.5 Leading indicators (watch every week) | §16 / App. E | Merged |
| HYB:1608 | 30.6 Cut lines (what to drop first if time or energy runs short) | §5 | Merged |
| HYB:1619 | 30.7 Post-mortem questions for the final review | §18 / App. H | Merged |
| HYB:1624 | PART 5 — COMPLETENESS: GAPS, ASSUMPTIONS, OPEN ITEMS, IDEAS | §1–§20 (cross-cutting) | Included |
| HYB:1626 | 31. Things you may have missed | §17 | Included |
| HYB:1665 | 32. Gaps in the source requirements (honest list) | §18 / App. H | Included |
| HYB:1685 | 33. Assumptions and spikes | §1–§20 (cross-cutting) | Included |
| HYB:1687 | 33.1 Spikes (small experiments that turn [A]/[S] into [V] or tell us to use the fallback) | §1–§20 (cross-cutting) | Merged |
| HYB:1712 | 33.2 Assumptions register (everything labelled [A] or [S]) | §1–§20 (cross-cutting) | Merged |
| HYB:1730 | 34. Open items — decisions I made under your delegation (override any) | §18 / App. H | Included |
| HYB:1749 | 35. Appendices | §1–§20 (cross-cutting) | Included |
| HYB:1751 | Appendix A — Glossary | §20 | Merged |
| HYB:1773 | Appendix B — Worked swap (what actually changes on disk) | §5 | Merged |
| HYB:1791 | Appendix C — Source files and how this document uses them | §1–§20 (cross-cutting) | Merged |
| HYB:1811 | Appendix D — Sources consulted for [V] facts (fetched or searched 2026-11-12) | §1–§20 (cross-cutting) | Merged |
| HYB:1832 | 36. Beyond baseline — ideas for the "120%" | §17 | Included |

## Appendix H. Topic × source matrix, known gaps and assumptions
Matrix entries mean **explicit discussion**, **mention only**, or **not found in source**; they do **not** imply a topic is resolved. `HYB` is the most recent supplied draft and is partly derivative of all other files.
| Topic | HYB | A | B | T1 | T2 | T3 |
|---|---|---|---|---|---|---|
| Product roles/modes | Explicit | Explicit | Absent | Explicit | Mention | Explicit |
| Slot geometry and acceptance | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Component schema/library | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Content separate from code | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Swap and recovery | Explicit | Explicit | Explicit | Explicit | Absent | Explicit |
| JSONC, grammar, parser | Explicit | Absent | Explicit | Absent | Explicit | Explicit |
| Minimal diff and external edits | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| State/revision/operations | Explicit | Mention | Explicit | Explicit | Explicit | Explicit |
| Custom source/overrides | Explicit | Explicit | Explicit | Mention | Absent | Explicit |
| Code editor, compiler | Explicit | Explicit | Explicit | Mention | Mention | Mention |
| Sandbox/CSP | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Preview parity | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Static publish and rollback | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Public URL, SEO | Explicit | Mention | Absent | Mention | Mention | Absent |
| All browsers + mobile | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Local-folder/zip | Explicit | Explicit | Explicit | Absent | Absent | Mention |
| Offline/cloud-free demo | Explicit | Explicit | Mention | Absent | Mention | Explicit |
| Auth/Supabase/RLS | Explicit | Mention | Absent | Mention | Absent | Mention |
| Privacy and abuse | Explicit | Explicit | Explicit | Explicit | Mention | Absent |
| History snapshots | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Editor accessibility | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Test plan and spikes | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Quality/invariants/errors | Explicit | Explicit | Explicit | Mention | Explicit | Explicit |
| Premortem/cut-lines | Explicit | Explicit | Mention | Explicit | Mention | Explicit |
| CLI & future variants | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
| Licensing and cost | Explicit | Mention | Explicit | Explicit | Explicit | Mention |
| Wireframe mapping | Explicit | Explicit | Absent | Explicit | Absent | Explicit |
| Component provenance | Explicit | Absent | Explicit | Absent | Absent | Absent |
| Unsupported code warnings | Explicit | Explicit | Mention | Explicit | Explicit | Explicit |
| Asset image pipeline | Explicit | Explicit | Explicit | Explicit | Explicit | Explicit |
### H.1. Known gaps retained without invention
| Gap | Source statement | Current status |
|---|---|---|
| G1 | Rows 1, 2, 9, 10, 11, 12 are missing from the pasted D01–D90 table (the paste was truncated) | Possibly D01, D02 (product framing, accounts?) and D09–D12 (between sync and preview — maybe assets, themes, collaboration?) are unknown to this blueprint; see §3.1 / §18 for final treatment |
| G2 | Only D03–D08, D13 and D14 are visible; D15–D90 detail is not in the paste | The blueprint covers the editor scope only; see §3.1 / §18 for final treatment |
| G3 | Wireframes are images; slot names are my reading of them | Names (hero.title etc.) could differ from your intent; see §3.1 / §18 for final treatment |
| G4 | "Up to 10 layouts/templates" can mean layouts, templates, or both | Counts and presets differ; see §3.1 / §18 for final treatment |
| G5 | Whether a wireframe is a whole page or a section | Changes the data model; see §3.1 / §18 for final treatment |
| G6 | Round E1 option letters (A–D) for Q31–35 were not saved, only the meaning | Can't re-quote the choice letters; see §3.1 / §18 for final treatment |
| G7 | Numbering offset in your last message's answers | Risk of misreading a decision; see §3.1 / §18 for final treatment |
| G8 | "UX laws" is not defined | Which laws?; see §3.1 / §18 for final treatment |
| G9 | "Free API / free online compiler" vs "runs offline" | Free online services can vanish; see §3.1 / §18 for final treatment |
| G10 | Target audience of visitors (recruiters? clients?) | Affects templates, résumé, SEO; see §3.1 / §18 for final treatment |
| G11 | Multi-page portfolios | Navigation, routing, SEO; see §3.1 / §18 for final treatment |
| G12 | Whether the editor must work without an account | Affects first-run; see §3.1 / §18 for final treatment |
| G13 | Data from the rest of Kadmeion (projects, GitHub import, etc.) is out of scope | Integration questions; see §3.1 / §18 for final treatment |
| New: G14 [C] | Original five L1–L5 images not currently attached in this file set | Original visual fidelity not verified; request images only before final design asset generation |
| New: G15 [C] | Original D01–D90 **feature-table rows 1,2,9–12** absent | Do not reconstruct original wording from normalized decision register |
| New: G16 [C] | Original hybrid assumes GitHub login and optional Mongo fallback | Superseded by full Supabase-only, ordinary email + optional Google |
### H.2. Original delegated-open-item register O1–O12
| Original ID | Original question | Source default | Final interpretation |
|---|---|---|---|
| O1 | Variants/branching | Not in v1; Duplicate portfolio instead | [C] Preserved; no new owner response needed |
| O2 | Slot names | Table in §12 | [C] Preserved; no new owner response needed |
| O3 | Which layouts first | L1 → L4 → L3 → L2 → L5 → L6–L8 | [C] Preserved; no new owner response needed |
| O4 | Swap policy on custom code | Confirm dialog (Keep as my component / Replace / Cancel) | [C] Preserved; no new owner response needed |
| O5 | Licence | MIT | [C] Preserved; no new owner response needed |
| O6 | Public URL scheme | kadmeion.vercel.app// | [D/S] Target only; exact host and direct-path behavior unverified |
| O7 | Sections-per-page interpretation (H21) | Section layouts, single page | [C] Preserved; no new owner response needed |
| O8 | Editor structure | One editor, Code tab, Files = Advanced | [C] Preserved; no new owner response needed |
| O9 | Sign-in provider | GitHub | [D] Superseded: email Supabase, optional Google. GitHub NOT mandatory |
| O10 | Reserved CLI name | kad (not built) | [C] Reserved only; no CLI v1 |
| O11 | Template count in v1 | 5 presets | [C] Preserved; no new owner response needed |
| O12 | UX laws list | Eight in §14.5 | [C] Preserved; no new owner response needed |
### H.3. Unproven claim and assumptions register
The following are explicitly [S] and may NOT be promoted to [V] without the proposed experiment: **Puck irregular/nested canvas fit** (S1/SP11), **cross-file CSS isolation** (SP9), **compiler & per-slot error containment** (S2/SP9), **JSONC whitespace/comment preservation** (SB1/SP12), **file-folder permissions and external edit races** (SB6/SP3), **mobile code editing** (SP4), **portable static build & SEO** (SP5/SP7), **Vercel deployment/terms/subdomain** (SP2/SP10), **Supabase quotas/RLS under real load** (SP6), **safe hostile JS** (SP1/SP9), **cross-platform deterministic build** (SB4), **browser offline data preservation** (SB7/SP8), **all-cloud-loss demo** (SP8). Every numerical latency/size/contrast threshold not directly backed by a dated standard is [A] pending acceptance testing.

## Appendix I. Per-source extraction, unique contributions, and final rationale
| Source | Core thesis (two sentences) | Best contribution (boon) | Weakness / bane | Chosen handling |
|---|---|---|---|---|
| T1 | Use typed slot layouts and a validated page document rather than slicing editor text. Generate code from a deterministic composition tree so canvas actions cannot corrupt source. | Concrete delete → empty slot → drop → regenerate walkthrough and slot types. | Code appears generated/locked; weaker editable project representation. | Merge operational model into §5; use user-owned source separation in §6. |
| T2 | Treat the portfolio as developer-owned project files and route every edit through a transaction engine. Use a bounded editable composition language with untrusted custom code treated separately. | One writer/many lenses, inverse operations, closed grammar, component manifest. | Parser/source maps and SDK raise implementation complexity. | Adopt controlled file model, defer CLI/branches. |
| T3 | Define a desired finished system by verifiable quality guarantees. Combine document safety and files-first ownership into one renderer, sandbox and release pipeline. | G1–G10 tests, release state machine, honest limitation ladder. | Absolutist “no invalid save”, “preview equals production” claims undercut real draft/host failures. | Qualify and test every guarantee (§13–§14). |
| A | Use one JSON document with slot content separated from component code and protected overrides. Drive editor modes from one model, with stash and fault-local previews. | S0/S1/S2 swap states, I1–I13, E01–E18, error/roadmap detail. | Assumes portable safe React compilation and local persistence without proof; opaque code integration costly. | Retain safety rules, compatible project schema, user-owned file snapshots. |
| B | Treat files as an open, versioned interface edited with minimal, grammar-checked operations. Expose provenance and run a shared core in browser and optional future tools. | JSONC/Grammar Guard, minimal diffs, developer/tech-lead scorecard, testable contracts. | JSONC comments can be mangled; native folder picker varies, v1 CLI/branches unacceptable. | Adopt with SB1 gate and browser-tier fallback; no CLI/branches v1. |
| HYB | Reconcile A and B into one planning blueprint with H1–H21 decisions and R01–R33 requirements. Define hosted URLs, staged build, browser tiers, and detailed mechanisms. | Complete IDs H/R/I/E/F/O/S/SB/SP and original owner decisions; 8-section + 5-preset taxonomy. | GitHub auth conflicts with Supabase-only amendment; Vercel Blob/Edge HTML assumptions and public code isolation unproven. | Supersede auth/backend/hosting claims; preserve ID corpus and defer vendor bets. |
### I.1. Decision comparison across five architectures
| Architecture | Strength | Failure mode | Choice |
|---|---|---|---|
| Code-text surgery | Direct-looking source edits | Formatter/comments/user typing destroy boundaries | Drop — unacceptable corruption risk [C] |
| Document-only JSON | Small and safe canvas editing | Developers cannot directly own structure/files | Merge as internal validated graph [C] |
| Raw source first | Full apparent code freedom | Cannot safely reverse engineer arbitrary JS into visual components | Drop universal reverse sync [D] |
| Files-first unbounded | Developer ownership and open files | Parser/SDK/hosting/sandbox scope overload | Merge closed file grammar; defer CLI/branches [C] |
| Contract-first staged hybrid | Bounded code ⇄ visual, export, safety | Still significant JSONC/sandbox/publishing risks | Adopt conditional gates [D/C/S] |

### I.2. Complete source-specific ID detail (outside the Hybrid H/R/I/E/F register)
These tables restore specific meanings that would otherwise be lost by merely mentioning an ID range. When a source contradicts newer owner decisions, the final disposition names the override instead of silently adopting the old proposal.
#### I.2.1 Perspective A principles P1–P13
| Source ID | Principle | Original mechanism/outcome | Final disposition |
|---|---|---|---|
| SPEC-A:P1 | One source of truth | Everything the editor shows is derived from the Document; The code panel, canvas and preview are projections, never separate copies | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P2 | Layouts own structure | Users never edit the page skeleton in template or visual modes; Slot code cannot escape its box; the grid belongs to the layout | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P3 | Content is not code | Words, images and links live apart from code; Swapping a component keeps the user's text and images | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P4 | Explicit over magic | If something cannot be done automatically, say so and offer a way forward; Warning dialogs with clear choices, never silent rewrites | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P5 | Nothing is destroyed | Every change is reversible; Stash, snapshots, undo, restore | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P6 | One render path | Canvas, preview and published output use the same compile path; No "looked fine in the editor" surprises | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P7 | Fail safe | A failure in one place must not take down another; Error boundary per slot, last-working preview kept | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P8 | Pin everything | Existing portfolios never change because the library changed; Components referenced as id@version; upgrades are opt-in | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P9 | Treat user code as hostile | It may be wrong or malicious; Sandboxed iframe, separate origin, dependency allowlist | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P10 | Gates before output | Quality is checked before publishing, not after; Accessibility, performance and validity checks block bad releases | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P11 | Local-first | The user's work survives refreshes and outages; Autosave to the browser first; the cloud is an add-on | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P12 | Progressive disclosure | Non-coders never meet code; coders can reach all of it; Code panel is hidden until asked for; defaults first, overrides behind "advanced" | Adopt qualified by §4/§13 [C/S] |
| SPEC-A:P13 | No lock-in | The user can always leave with their work; One-click zip export of a complete static site | Adopt qualified by §4/§13 [C/S] |
#### I.2.2 Perspective A numbered flows F1–F10
| Source ID | Original user journey | Final mechanism |
|---|---|---|
| SPEC-A:F1 | F1 — First visit to a published portfolio (J1) | §9/§12 [C/S] |
| SPEC-A:F2 | F2 — Swap one component (pristine slot) | §5 [C/S] |
| SPEC-A:F3 | F3 — Swap over edited code (S2) | §5 [C/S] |
| SPEC-A:F4 | F4 — Edit slot code, hit an error, recover | §5 [C/S] |
| SPEC-A:F5 | F5 — Refresh or crash mid-edit | §6/§10 [C/S] |
| SPEC-A:F6 | F6 — Publish and roll back | §9/§12 [C/S] |
| SPEC-A:F7 | F7 — Reviewer link | §9/§12 [C/S] |
| SPEC-A:F8 | F8 — Library upgrade | §6/§10 [C/S] |
| SPEC-A:F9 | F9 — Change layout | §5 [C/S] |
| SPEC-A:F10 | F10 — Custom builder start | §5 [C/S] |
#### I.2.3 Perspective A R1–R18 premortem specifics
| Source ID | Original failure | Original remedy | Final prevention |
|---|---|---|---|
| SPEC-A:R1 | In-browser compile of user React is unreliable | Spike S2 first; per-file transform + import map fallback | §16/§14; additional causes: Multi-file bundling in the browser is the least proven part |
| SPEC-A:R2 | Users lose content on swap or layout change | Content/code separation; stash; property tests (I1) | §16/§14; additional causes: Content stored inside component code, or no stash |
| SPEC-A:R3 | Edited code destroyed on swap | I10; confirmation token; keep-as-component option | §16/§14; additional causes: No confirmation on S2 |
| SPEC-A:R4 | Library update changes saved portfolios | Version pinning (I5); opt-in upgrades | §16/§14; additional causes: Components not pinned |
| SPEC-A:R5 | Layouts break on mobile | Per-layout areas from P0; matrix tests | §16/§14; additional causes: Responsive treated as a later phase |
| SPEC-A:R6 | One component's CSS or JS breaks another | Scoped CSS, contained boxes, error boundaries (I6, I7) | §16/§14; additional causes: Shared globals, unscoped styles |
| SPEC-A:R7 | Preview and published site differ | One path (I3); visual regression of preview vs build | §16/§14; additional causes: Two render paths |
| SPEC-A:R8 | Published sites not discoverable | Resolve S4; pre-rendered metadata fallback | §16/§14; additional causes: Client-only rendering |
| SPEC-A:R9 | Security incident from user code | Sandbox, separate origins, CSP, allowlist (I12) | §16/§14; additional causes: Same-origin execution |
| SPEC-A:R10 | Scope overload | Three layouts first; cut lines (§11.4) | §16/§14; additional causes: Ten layouts × polish × all modes |
| SPEC-A:R11 | Library content is far larger than planned | Parameterised variants; library size budget (§11.2) | §16/§14; additional causes: Components counted but not their variants, states and tests |
| SPEC-A:R12 | Free-tier cliff or hosting change | Static output; zip export; separate publisher module | §16/§14; additional causes: Hard dependency on one provider |
| SPEC-A:R13 | Templates look generic | Two excellent layouts before scaling; design review at P2 | §16/§14; additional causes: Visual design done last and rushed |
| SPEC-A:R14 | Editor feels slow | Incremental per-slot compile; debounce; targets in §10.5 | §16/§14; additional causes: Re-compiling everything on each edit |
| SPEC-A:R15 | Users confused by modes or warnings | Progressive disclosure; usability tests; message design (§10.3) | §16/§14; additional causes: Too many controls; unclear copy |
| SPEC-A:R16 | Drag-and-drop unusable for some users | Keyboard alternative on every slot (§10.2) | §16/§14; additional causes: Mouse-only interaction |
| SPEC-A:R17 | Canvas library lock-in or breaking changes | Pin version; keep the Document independent of the library's format; adapter layer | §16/§14; additional causes: Dependence on one library's data model |
| SPEC-A:R18 | Reviewer links can't expire | Plan the small server component; cut line §11.4 | §16/§14; additional causes: No server-side piece |
#### I.2.4 Perspective B principles B1–B14
| Source ID | Principle | Original behavior | v1 decision |
|---|---|---|---|
| B:B1 | Files are the API | The project format is the stable, public interface; Anyone can read or generate a project without the editor | Adopt with bounded scope [C/S] |
| B:B2 | Show your work | Nothing on screen is unexplained; Provenance for every element; "why is it like this?" panel | Adopt with bounded scope [C/S] |
| B:B3 | Minimal diffs | An edit changes only what it must; Visual actions produce small, reviewable text changes | Adopt with bounded scope [C/S] |
| B:B4 | Closed grammar, open code | The editor writes only to files it fully understands; Component code is never rewritten by the tool | Adopt with bounded scope [C/S] |
| B:B5 | Deterministic | Same input, same output, every time; Reproducible builds with verifiable hashes | Adopt with bounded scope [C/S] |
| B:B6 | One core, many shells | Same logic in browser, command line and automation; The editor is one client of the core, not the only one | Defer CLI only; preserve shared pure core [D/C] |
| B:B7 | Contracts with tests | Each interface is specified and has a conformance suite; Third parties can prove they comply | Adopt with bounded scope [C/S] |
| B:B8 | Boring where it matters | Standard formats and well-known tools for the foundation; JSON-with-comments, semantic versions, static output | Adopt with bounded scope [C/S] |
| B:B9 | Escape hatch at every level | The user can always go one level lower; Template → visual → file → custom code, no dead ends | Adopt with bounded scope [C/S] |
| B:B10 | Compatibility is a promise | Old projects keep opening; Migrations, deprecation windows, golden tests of old projects | Adopt with bounded scope [C/S] |
| B:B11 | Docs are a feature | The documentation is part of the product; Docs tested like code; every contract has examples | Adopt with bounded scope [C/S] |
| B:B12 | Measure, then claim | No claim without a number; Budgets, benchmarks and gates published | Adopt with bounded scope [C/S] |
| B:B13 | Fail small | A problem stays where it happened; Per-file, per-slot containment (Spec A I6, I7) | Adopt with bounded scope [C/S] |
| B:B14 | Defaults for beginners, power for experts | Both audiences served by the same tool; Files hidden until asked; command palette available always | Adopt with bounded scope [C/S] |
#### I.2.5 Perspective B flows FB1–FB9
| Source ID | Original flow | v1 disposition |
|---|---|---|
| B:FB1 | A visual edit becomes a tiny diff | Adopt §5/§6 [C/S] |
| B:FB2 | Editing in VS Code while the editor is open (local folder mode) | Adopt §5/§6 [C/S] |
| B:FB3 | Break something on purpose | Adopt §5/§6 [C/S] |
| B:FB4 | Variants for different job applications | Defer branching/variants; use Duplicate Portfolio (§6) [D/C] |
| B:FB5 | Writing a new component | Keep in-app Custom Components; **drop CLI commands** (§7) [D] |
| B:FB6 | Pipeline check and release verification | Keep in-app pipeline/check interface; **drop CLI commands** (§14) [D] |
| B:FB7 | A tech lead's 30-minute evaluation (the scripted "demo that must pass") | Tech-lead evaluation through GUI, browser harness and existing test tools; no user CLI (§14) [D] |
| B:FB8 | Opening someone else's project (zip) | Adopt restricted ZIP import (§8/§10) [C/S] |
| B:FB9 | Crash in the middle of a multi-file operation | Adopt journal and recovery (§6/§10) [C/S] |
#### I.2.6 Task 3 guarantees G1–G10 (qualified for reality)
| Source ID | Original guarantee | Source verification method | Final qualified target |
|---|---|---|---|
| T3:G1 | No invalid page can be saved | Property tests on the engine; a production counter of rejected commits, by reason | Only committed graph, not source text buffers nor unfinished draft eligibility [S] |
| T3:G2 | No edit is silently lost | Crash-recovery tests (kill the tab mid-edit); data-loss reports must be zero | Durable after adapter acknowledgment; browser eviction and offline backup still risks [S] |
| T3:G3 | Visual and code never silently disagree | Property test: after any random edit sequence, every lens equals the projection of the head revision | For supported structured content, not unrestricted code interpretation [S] |
| T3:G4 | Every action is reversible | Reversibility law, thousands of random cases | Reversible recorded editor operations only; permanent erasure and external actions excluded [S] |
| T3:G5 | Preview equals production | Automated image comparison of preview against published page at four widths | Shared frozen inputs; dynamic custom code, network and delivery cache require tests [S] |
| T3:G6 | A published version never changes | A periodic integrity check that served bytes match the stored hash | Immutable releases until lifecycle retention/deletion; pointer separate [S] |
| T3:G7 | Every limit is shown, nothing unsupported is silently altered | Fuzz test: arbitrary custom files survive every operation byte-for-byte; a test per unsupported case asserts the message | Unsupported behavior surfaced; custom source protected [S] |
| T3:G8 | User code cannot harm the platform or other users | Adversarial test suite and an external security review before launch | Safety goal, not certainty; disable script until adversarial isolation proven [S] |
| T3:G9 | Published pages meet a baseline for accessibility and speed | Automated audits on every publish; periodic manual accessibility review of the templates | Validated target, automated audits alone insufficient; manual accessibility essential [S] |
| T3:G10 | Anything can be exported | Export-then-import identity test; the exported site builds offline | Export from owned data/assets within retention; never credentials or unauthorized code [S] |
#### I.2.7 Task 1 original R1–R11 early requirements
| Source ID | Task 1 requirement | Final destination |
|---|---|---|
| T1:R1 | A library of up to 10 layouts/templates, empty or with sample text | §3/§5, via HYB:R01–R33 [D/C] |
| T1:R2 | A library of prebuilt React components with working code | §3/§5, via HYB:R01–R33 [D/C] |
| T1:R3 | Components drop into the matching regions of a layout | §3/§5, via HYB:R01–R33 [D/C] |
| T1:R4 | Templates ship with typography, motion and UI/UX rules built in; the user edits content only | §3/§5, via HYB:R01–R33 [D/C] |
| T1:R5 | Deleting a component empties that region’s code, and the region waits | §3/§5, via HYB:R01–R33 [D/C] |
| T1:R6 | Dropping a component maps its library code into that region | §3/§5, via HYB:R01–R33 [D/C] |
| T1:R7 | If a swap cannot be reflected in code, the user is told and shown what to do | §3/§5, via HYB:R01–R33 [D/C] |
| T1:R8 | Images go into image slots without touching any code | §3/§5, via HYB:R01–R33 [D/C] |
| T1:R9 | Custom builder: blank page, user adds layouts/components and writes code where needed | §3/§5, via HYB:R01–R33 [D/C] |
| T1:R10 | No visual-to-code reverse engineering of arbitrary source | §3/§5, via HYB:R01–R33 [D/C] |
| T1:R11 | Template, visual and source modes coexist; unsupported source is preserved, never silently changed | §3/§5, via HYB:R01–R33 [D/C] |

## Appendix J. Second-pass audit results and open defects
The second pass checked the **source file bytes and headings** again and reconciled all source top-level and nested headings with this appendix. Machine-audited counts are reported below; design claims remain untested until authorized PoCs. The audit distinguishes **documentation conformance** from **software feasibility**.
| Audit check | Result | Evidence and correction |
|---|---|---|
| All unique source files read completely | PASS (text) | 6 unique/11 uploaded `.md` files. Each source decoded and read to EOF, re-indexed by lines/headings in second pass; byte duplicates hash-confirmed. |
| All Markdown source headings reconciled | PASS | 468/468 headings mapped to Appendix G; mapping is a section-level coverage aid, not a claim of verbatim copying. |
| Hybrid H/R/I/E/F/O + S/SB/SP IDs | PASS | H21, R33, I24, E30, F28, O12, S7, SB7, SP5: 167 original rows retained in their source namespaces; missing = 0. |
| Markdown tables regularity | PASS | Nonuniform column counts detected: 0. See limitations below if any. |
| Code block fences balanced | PASS | 8 triple-backtick fence lines. |
| Numbered top-level sections and appendix order | PASS | Sections 0–20; Appendices A–J, each once and ordered. |
| Final section cross-references | PASS | Detected 0 potentially dangling unqualified § references; original Hybrid §26.2/§32 remain valid source citations. |
| [V] claims backed by dated source links | PASS | 15 official/primary URL rows indexed (§19). This checks presence of evidence, not future vendor stability. |
| [A]/[S] claims registered | PASS (document) | Appendix F includes all 19 original spikes and additional SP6–SP12; H.3 records unresolved assumptions. Actual PoC outcomes are untested. |
| User constraints, later Supabase amendment, no CLI/branches and browser tiers | PASS (specification) | §§1–3, 9–11, 17–18 and Appendices B/H. Real server, browser and safety behavior remains [S]. |
| Five source wireframe pixels + six missing D01–D90 feature-table rows | OPEN SOURCE GAP | Images and original untruncated feature-table rows not mounted; mappings from written sources only; cannot certify visual or original wording completeness. |
| Application test, compiler proof, production publish and security assessment | NOT RUN (correct permission boundary) | This is planning only; no test results or implementation claims. |

**Corrections applied in this audit:** fixed erroneous final-document cross-references (§24 and §§21–25), flagged proprietary SaaS vs OSS-code distinction, separated historical section references from final ones, preserved collisions by source prefixes, and recorded open validation rather than treating research claims as completed tests. No unapproved source file changes were made to the application.

**Audit outcome:** Documentation traceability PASS; provider/browser/code behavior **UNVERIFIED** until [S] experiments. This audit is about the specification, not proof of feasibility.
