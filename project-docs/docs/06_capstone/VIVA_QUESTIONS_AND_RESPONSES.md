# Capstone Viva / Technical Review Questions and Defensible Answers

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

1. **What makes Kadmeion different from a static React portfolio?** A typed-slot, versioned, source-preserving authoring workflow with protected custom components, explicit public publication, and optional later private growth; it is a proposed architecture, not yet measured to be better.
2. **Why not use MongoDB/Express?** The owner chose Supabase Auth/PostgreSQL RLS/Storage/Edge Functions for the application backend; an extra persistent Express/Mongo layer would duplicate business functions and complexity without an approved need.
3. **What is the durable source of truth in the editor?** The committed portable project file set. The parsed project graph and visual/source panes are synchronized views of its revision.
4. **What happens when a component is deleted?** Its assignment becomes EMPTY; typed content/media/custom source are retained in stash/history and Undo, and a required empty slot can save as draft but fail publication.
5. **How do S0, S1 and S2 differ?** S0 is pristine library use; S1 an identical user-owned detached copy; S2 a modified owned override. User-owned files are never silently overwritten.
6. **How is arbitrary user code managed?** Opaque authored files, explicit Customize/Detach, restricted compiler/preview and fail-closed public JavaScript policy; independent source export remains.
7. **Why are theme tokens hierarchical?** Global palette/typesetting needs consistent defaults, while per-section/component/breakpoint overrides allow customization without rewriting protected TSX source.
8. **Why is mobile portfolio editing excluded?** The owner prioritizes a trustworthy, keyboard-accessible multi-pane authoring experience. Phones remain compatible with viewing and sharing, not source editing.
9. **Why use immutable releases?** A frozen build can be compared, validated, rolled back and identified by hash; a controlled visibility pointer must separately enforce public access.
10. **Can public pages survive Supabase sleeping?** Only if the selected static delivery host can serve bytes and resolve visibility independently; it is a testable design goal, not a guarantee.
11. **Why is immediate unpublishing difficult?** CDN caches and direct immutable asset URLs can retain old content. Authoritative route revocation and cache behavior must be verified in the actual host.
12. **Can users be forced to connect GitHub?** No. Projects are manual/link-based; optional P2 providers use permitted public data where possible; handle match does not prove ownership.
13. **How is DevScore fair?** It is private, category-based and explainable; no composite if comparable data coverage is insufficient; no public leaderboard.
14. **How is visitor privacy protected?** Aggregate analytics is OFF until explicitly enabled per published portfolio. No persistent visitor fingerprint/identity is in the approved design.
15. **How is profile privacy separate from portfolio privacy?** Publishing a portfolio does not automatically publish the profile hub or individual private projects; every public surface requires specific exposure.
16. **What is Brevo's role?** Selected transactional email delivery candidate for Supabase password recovery; no real SMTP integration or free-sender deliverability has been proven.
17. **What are the main security concerns?** Cross-user RLS, untrusted custom JS, reviewer link bypass, SSRF in remote screenshots, expired Auth states, unpublish caching and operator privilege escalation.
18. **Why not implement all 115 requirements immediately?** They are UI decisions across P1–P3, not 115 independent ready-made code features. A student project needs dependency and security gates to avoid shipping a beautiful but unsafe mock application.
19. **What has actually been tested so far?** This documentation package performed structural file/index checks only. Historical synthetic feasibility tests are not the real integrated Kadmeion app or live provider tests; all planned application tests remain NOT_RUN.
20. **What is the safe minimum deliverable if free public host fails?** Authenticated local-capable versioned portfolio editor with portable project/static export, while hosted public URL support stays explicitly blocked until privacy and cost proof passes.
21. **Why WCAG 2.2 AA?** It is the approved accessibility design target; real keyboard/screen-reader/reflow tests are required for any conformance assertion.
22. **What is the admin role allowed to do?** Limited user status and documented account restrictions/restores, serious-abuse temporary unpublish, notices and appeals; no impersonation or editorial modification of author content.
23. **What exactly does “source-preserving” mean?** Controlled managed files may change through typed operations; opaque owned source changes only through explicit user source edits or clearly confirmed copy/stash workflows, tested byte-for-byte.
24. **How do you handle two editor tabs?** Compare-and-swap based on base revision, preserve conflicts as separate recoverable state, never silently last-write-wins.
25. **Which measured results justify the project currently?** No application results yet. The current deliverable is a documented, source-grounded architecture and a named evidence plan; measured results require actual implementation.
