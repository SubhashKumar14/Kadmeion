# Software, Hardware and Execution Environment Requirements

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Development environment (proposed)

| Component | Candidate requirement | Proven? |
|---|---|---|
| Operating system | Windows 11, Linux or macOS with supported terminal/editor and local browser | Not a codebase requirement; no build executed |
| Frontend language | TypeScript, React and accessible HTML/CSS/SVG; Vite or suitable open-source build configuration | Candidate, pin versions after setup |
| Backend | Supabase Auth/PostgreSQL/RLS/Storage/Edge Functions/RPC | Approved platform, not provisioned/tested here |
| Local data | IndexedDB and optional File System Access directory adapter; ZIP fallback | Browser compatibility requires test |
| Editor compiler | Isolated, pinned TSX/JS/CSS transform candidate, Monaco only on supported desktop | Library/host isolation not chosen/proven |
| Static delivery | Candidate Vercel/Cloudflare Free, or independent local static server for export tests | Host not selected |
| QA | Browser E2E + unit + Postgres policy tests + accessibility/manual SR test tools | Planned, no tests executed |

## Target devices

Authoring: desktop/laptop with keyboard accessibility, and qualifying large tablets after input/browser/viewport test. **Phones cannot edit portfolio or code.** Public pages: responsive desktop/tablet/phone. Student local 16GB-RAM / 6GB-VRAM class hardware is sufficient for ordinary web tooling in principle; no measured build time or resource guarantee is asserted.

## Minimum end-user operation

Modern supported browser, secure connection for Auth and cloud features, no paid membership required for base project; editing availability subject to supported device. Published static portfolios must render without client JavaScript once delivered; privacy/unpublish depends on host access checks. Offline authoring and source recovery require previously established access to local project data; current user cannot sign up offline.

## Service requirements and exclusions

Supabase and selected Brevo free tiers must be validated for public authentication. External developer platforms are optional and link-only if automated free public facts are not permitted. Custom source execution is disabled for live visitors without proven isolation. Untrusted SDKs/paid APIs/forced OAuth and personal visitor tracking are excluded.
