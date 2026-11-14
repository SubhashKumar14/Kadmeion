# User Stories, Functional Analysis and Acceptance

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Functional slices (prioritized)

| Story | User need | Observable acceptance |
|---|---|---|
| US-01 | As a guest, I register using email/password with a unique handle. | Final unique handle committed, own account private, correct validation and recovery availability. |
| US-02 | As a new developer, I choose a useful starting action without forced GitHub. | Welcome presents profile/portfolio/connections, and Skip/Resume works. |
| US-03 | As a developer, I describe an honest non-GitHub project. | Save private record with optional live/repo links and manual screenshot; no repository cloning. |
| US-04 | As a developer, I build visually and alter components without losing words or code. | EMPTY/stash/Undo, owned S2 protection, mapping and single transaction revision pass. |
| US-05 | As an advanced developer, I customize trusted component source. | Read-only base, protected owned source, diagnostics, safe preview/static fallback. |
| US-06 | As a developer, I control each public surface. | Profile/project/portfolio exposure independently confirmed, no hidden private fields. |
| US-07 | As a visitor, I can open a responsive portfolio and original project links. | Static HTML works without JS; repo/live links explicit and valid scheme. |
| US-08 | As a developer, I review exactly what will be published. | Author vs Published preview and preflight blockers explain static/capability differences. |
| US-09 | As a developer, I can share a temporary review then revoke it. | Expiring server token and accessible read-only staging. |
| US-10 | As a developer, I can roll back or export safely. | Immutable release comparison, verified pointer/route, portable project/static ZIP. |
| US-11 | As a developer, I can recover an accidental deletion. | 15-day item Trash, private Restore, no silent republish. |
| US-12 | As a developer, I understand who sees my activity and traffic. | Provider cards private, coarse analytics OFF until per-portfolio opt-in (P2). |
| US-13 | As a developer, I track my growth without public ranking. | Explainable private score only with source coverage; editable goals (P2). |
| US-14 | As an operator, I can handle abusive material without editing an author's portfolio. | Authorized restriction, notice/audit/appeal and verified temporary takedown only. |

## Dependency ordering

US-01 → US-03/04 → US-08 → US-07/10; privacy US-06 gates public visibility. Editor operations depend on Project/Component/Operation contracts. Publication depends on Build/Release contracts and host verification. P2 analytics depends on successfully published P1 routes and explicit opt-in; provider facts depend on allowed free source APIs.

## Nonfunctional proof criteria

No test is a PASS until reproduction evidence exists. Requirements provenance: UI-001–115 and the final 1647-line editor blueprint where not superseded. Capstone evaluation should distinguish implementation completion, usability evidence, security tests and performance measurements, not conflate them.
