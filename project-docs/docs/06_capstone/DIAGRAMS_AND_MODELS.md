# Architecture, Use Case, Activity, Sequence and State Diagrams

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

These Mermaid diagrams are **design models**, not diagrams reverse-engineered from a completed application. Rendering requires Mermaid-compatible Markdown viewer.

## 1. Overall use case relationships

```mermaid
flowchart LR
  Visitor[Public Visitor] --> Public[View published profile/portfolio/project]
  Visitor --> Guest[Register / Sign in]
  Developer[Developer] --> Private[Manage private identity and project]
  Developer --> Editor[Author portfolio with typed slots]
  Developer --> Preview[Author/Published Preview]
  Developer --> Stage[Create staged reviewer link]
  Developer --> Release[Publish / Compare / Rollback / Export]
  Developer --> Growth[Private goals/DevScore/analytics - Phase 2]
  Reviewer[Reviewer token] --> Stage
  Operator[Restricted operator] --> Admin[Manage user restriction / temporary moderation / appeals]
  Editor --> Preview
  Preview --> Release
```

## 2. Registration and authentication sequence

```mermaid
sequenceDiagram
  actor Guest
  participant UI as Auth UI
  participant Auth as Supabase Auth
  participant DB as Postgres/RLS
  participant Mail as Brevo SMTP (unproven)
  Guest->>UI: Registration name, handle, email, password
  UI->>DB: Handle availability (advisory)
  DB-->>UI: Candidate result
  Guest->>UI: Submit
  UI->>Auth: Create email/password identity
  Auth-->>UI: Auth status
  UI->>DB: Final normalized unique handle and private profile
  DB-->>UI: Commit or uniqueness conflict
  alt Needs password recovery later
    Guest->>UI: Request reset
    UI->>Auth: Reset request
    Auth->>Mail: SMTP request (only if proven)
    Mail-->>Auth: Delivery acceptance / error
    Auth-->>UI: Status for neutral confirmation
  end
  UI-->>Guest: Welcome actions or recoverable error
```

## 3. Component deletion/swapping sequence

```mermaid
sequenceDiagram
  actor Developer
  participant Canvas as Canvas or keyboard layer tree
  participant Core as Guarded editor core
  participant Store as Versioned project storage
  participant Preview as Preview renderer
  Developer->>Canvas: Delete filled slot
  Canvas->>Core: DELETE_SLOT + baseRevision
  Core->>Core: Validate, stash content and owned files
  Core->>Store: Journal + commit EMPTY revision
  Store-->>Core: Revision + hashes acknowledged
  Core-->>Canvas: EMPTY + Undo + stash ref
  Canvas->>Preview: Render committed revision only
  Developer->>Canvas: Swap custom S2 with trusted block
  Canvas->>Core: Ask impact/diff
  Core-->>Canvas: Keep / Replace and Stash / Cancel
  Developer->>Canvas: Explicit choice
  Canvas->>Core: Guarded swap
  Core->>Store: Atomic/recoverable commit
```

## 4. Static publication and rollback sequence

```mermaid
sequenceDiagram
  actor Owner
  participant UI as Releases / Preflight
  participant Build as Trusted static builder
  participant DB as Supabase trusted command
  participant Host as Selected public host (unproven)
  Owner->>UI: Publish frozen draft revision
  UI->>Build: Preflight + build inputs
  Build-->>UI: Blockers / warnings / output hash
  alt Critical blocker
    UI-->>Owner: Fix issue; live release unchanged
  else Pass
    Owner->>UI: Explicit visibility + confirm
    UI->>DB: Idempotent release request
    DB->>Host: Upload immutable assets/release
    Host-->>DB: Upload/checksum verified
    DB->>Host: Conditional live pointer switch
    Host-->>DB: Pointer result
    DB->>Host: Visitor GET canonical route
    Host-->>DB: HTTP/HTML/hash status
    DB-->>UI: LIVE_VERIFIED or failure/incident
    UI-->>Owner: Real outcome and rollback/export actions
  end
```

## 5. Project privacy revocation state

```mermaid
stateDiagram-v2
  [*] --> PrivateDraft
  PrivateDraft --> Exposed: explicit per-surface publication
  Exposed --> RevocationPending: author removes public exposure
  RevocationPending --> PrivateDraft: all active routes verified blocked/updated
  RevocationPending --> Incident: host/cache/direct URL still leaks
  Incident --> PrivateDraft: safe route suspension verified
  PrivateDraft --> Trashed: delete and route revoked
  Trashed --> PrivateDraft: restore within 15 days, NOT autopublished
  Trashed --> Purged: item recovery window and purge policy complete
```

## 6. User/admin authority boundary

```mermaid
flowchart TD
  Report[Report of serious abuse] --> Case[Moderation case with scoped evidence]
  Case --> Authz{Operator permission and reason valid?}
  Authz -->|No| Deny[Reject and audit denied action]
  Authz -->|Yes| Notice[Issue notice + mandatory audit event]
  Notice --> Suspended[Temporary public route suspension]
  Suspended --> Verify{Public route inaccessible?}
  Verify -->|Yes| Appeal[Owner appeal and case review]
  Verify -->|No| Incident[Critical revocation incident]
  Appeal --> Restore[Restore without editing authored content if justified]
```

## 7. Database ER model

See [Data Model/RLS](../04_engineering/DATA_MODEL_RLS_AND_STORAGE.md) for the complete logical ER diagram and row-level access matrix.
