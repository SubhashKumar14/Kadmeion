# OPS-03 — Appeals and case history

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

**Phase:** P1 · **Route:** `/app/operations/appeals` · **Actor/access:** Authorized restricted admin · **Primary action:** Resolve appeal  
**Owner decisions:** UI-74,93,113 · **Approval:** main behavior approved, URL/technical implementation proposed unless expressly fixed.

## Purpose and layout

Case timeline, reasons, scoped evidence, notices and resolution. The surface uses the approved Kadmeion visual family and does not depend on a decorative mock dashboard. It must expose authentic empty data, avoid invented achievements and preserve the user's chosen public/private boundaries. The primary action **Resolve appeal** is visually distinct from secondary options.

## Content and actions

Review, restore/unpublish, notify within policy. Provide clear field labels, contextual help, status feedback, keyboard equivalents and visible focus. Every destructive or public-facing operation requires a meaningful scope-specific confirmation; routine reversible edits use quiet inline feedback with Undo where feasible.

## Data/authorization and invariants

- **Who may read:** Authorized restricted admin. Deny all other reads at the storage/query/delivery boundary rather than hiding controls only in the UI.
- **Required invariant:** No broad surveillance or arbitrary editorial changes.
- **Data authority:** user-provided project/profile data is self-declared unless a provider-specific verification contract proves otherwise; public projection exposes only explicitly published fields.
- **Status truthfulness:** distinguish draft, persisted local, cloud-synced, staged, live-verified, stale, failed and private as applicable.

## State and failure matrix

| State | Required UI behavior |
|---|---|
| Initial | Render heading, current context, explicit primary action and no fake statistics. |
| Loading | Real content-footprint **glyph-shaped skeletons** only during pending data; accessible loading status; no artificial delay. |
| Empty | Relevant explanation, clear **Resolve appeal** or return action; no invented sample data presented as real. |
| Valid / success | Announce only confirmed outcomes; preserve focus and route intent; expose next action. |
| Validation / unauthorized | Explain correctable field-level issues; refuse unauthorized access without disclosing private records. |
| Network / quota / offline | Show local retry/return/export where applicable; preserve unsent draft buffers; label stale data. |
| Concurrent / stale | Compare, retry or keep both where content might otherwise be overwritten; do not silently discard work. |

## Interaction and responsive contract

- Navigation uses the appropriate Public, Auth, Workspace or Editor shell and consistent Back/focus restoration (UI-96).
- Desktop uses the approved editorial/productivity composition; mobile stacks content and exposes prominent touch-friendly actions **except phone portfolio/code authoring, which is blocked**.
- Keyboard: tab sequence follows visual and semantic order; Enter/Space activate buttons, Escape closes dialogs/drawers and focus returns to trigger; screen-reader name/role/state present.
- Motion: immediate press, 120–180 ms microinteraction, 180–250 ms standard panel, 280–320 ms auth only where relevant; motion reduced or removed under `prefers-reduced-motion`.
- Validate 200% zoom/reflow, dynamic text lengths, minimum target sizes, contrast and orientation on supported devices. WCAG 2.2 AA is a target, not a verified result.

## Acceptance checks (planned, NOT RUN)

1. Authorized actor reaches the route and completes **Resolve appeal** without any fake/dead control.
2. Unauthorized actor cannot read private data using direct URL, query or storage access.
3. Empty, loading, failure and confirmation states appear correctly; no false success.
4. Keyboard-only and screen-reader paths complete the main action with logical focus recovery.
5. Mobile view respects the no-phone portfolio/code-authoring rule, with usable fallback as relevant.
6. Public data, URLs and links follow explicit visibility and release rules; no analytics collected while disabled.

## Linked specifications

- [Master design system](../../../design.md) · [Workflow index](../../03_workflows/README.md) · [Screen register](../../../registers/SCREENS.csv) · [Security](../../04_engineering/SECURITY_AND_PRIVACY.md)
