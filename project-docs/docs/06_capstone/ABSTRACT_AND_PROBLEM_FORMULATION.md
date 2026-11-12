# Capstone Abstract, Problem Formulation and Objectives

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Abstract — Proposed Project (not a completed-system abstract)

Kadmeion is a proposed developer identity and portfolio-building platform designed to combine accessible visual composition with controlled source-code ownership and privacy-first publication. Its authoring architecture uses versioned portable project files, typed layout slots and one guarded transactional operation pipeline, preventing accidental loss when components are inserted, replaced, deleted or restored. Developers would create private project records linked to public repositories or live demonstrations without importing entire repositories, select curated templates or a blank canvas, customize design tokens and owned components, and compare author and publish-equivalent previews. Planned publication freezes a validated revision into a static HTML/CSS release, with explicit privacy controls, staging, rollback and independent export. The proposed application backend uses Supabase authentication, PostgreSQL row-level security and Storage, while public release delivery and custom-JavaScript isolation require technical validation. Later phases add optional public-handle platform synchronization, explainable private developer-growth indicators, personal goals and privacy-conscious aggregate visitor analytics. The project targets WCAG 2.2 AA accessibility and strictly zero recurring cost. At the time of this document, the system remains a **specification**; no implementation success or empirical results are claimed.

## Formal problem statement

Design a developer portfolio system that simultaneously provides: (i) individualized appearance and structured composition, (ii) preservation of user-authored content and source across visual editing operations, (iii) secure privacy-controlled public delivery with portable static output, and (iv) optional explainable growth insights—within student-level development resources, accessible interaction and strict nonbillable infrastructure constraints.

## Research/design questions (to validate)

- Can one versioned file set and guarded operations keep visual/code views consistent under destructive-looking edits, history and conflicts?
- Can a free-tier hosting configuration provide static HTML, independently accessible public releases and reliable revocation without an unsafe second business backend?
- Can trusted template assets and custom source share preview and static builds without allowing arbitrary authored JavaScript to escape its isolation boundary?
- Can accessible editor alternatives replace drag-only interactions and satisfy critical WCAG 2.2 AA success criteria?
- Can optional public provider facts be retrieved legally and free while retaining original metric meaning and privacy?

## Hypotheses — NOT results

H1: a guarded typed-slot model reduces accidental data loss compared with unconstrained source rewriting under the defined fixture set. H2: explicit publication gates and versioned static HTML improve revision parity/rollback audibility. H3: privacy-first exposure and clear source attribution reduce unintentional publication of private facts. These are **evaluation hypotheses**, not proven outcome claims.
