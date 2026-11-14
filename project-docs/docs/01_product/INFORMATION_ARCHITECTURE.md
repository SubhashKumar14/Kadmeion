# Information Architecture and Navigation

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Site map

```mermaid
flowchart TD
  Root[Public landing /] --> Explore[Explore public work]
  Root --> Templates[Template demos]
  Root --> SignIn[Sign in and sign up]
  SignIn --> Recovery[Recovery / Reset / OAuth callback]
  SignIn --> Welcome[Welcome]
  Welcome --> App[Workspace: Portfolio Studio / Projects / Growth]
  App --> Projects[Project gallery / Quick Add / Detailed case study]
  App --> Portfolios[Portfolio gallery / Template chooser / Editor]
  Portfolios --> Preview[Author preview / Published preview]
  Preview --> Staging[Expiring staging]
  Preview --> Publish[Preflight]
  Publish --> Releases[Releases / Rollback / Unpublish]
  App --> Growth[Developer Activity / DevScore / Goals / Analytics - P2]
  App --> Settings[Profile / Privacy / Security / Notifications / Trash / Export / Account Exit]
  App --> Ops[Role-limited Users / Moderation / Appeals]
  Root --> U[Public /u/:handle]
  U --> Case[Public /u/:handle/projects/:slug]
  U --> Static[Independent published portfolio URL]
```

## Navigation rules

1. Distinguish public landing navigation, compact auth shell, workspace side rail, full editor and restricted admin context. Maintain breadcrumbs and clear Back/cancel context.
2. Auth sign-in/signup mode switching does not add history entries. Page deep links (reset callback, public route) remain reloadable.
3. Editor section panels are **views** of one saved revision, not different project documents. Source and canvas paths must be synchronized through one writer.
4. Public identity and case studies occupy reserved `/u/` namespace; published portfolio routes must not shadow `/app`, `/signin`, `/signup`, `/auth`, `/r`, `/templates` or `/u`.
5. A developer may publish a portfolio independently of the public identity hub; do not implicitly open either when the other becomes public.
6. Mobile workbench operations are blocked; mobile public/appropriate account/goal screens remain usable.

## Content taxonomy

Identity → owned projects → optional public case studies → owned portfolios → versioned private drafts → staged read-only preview → releases → owner-controlled public projections → optional growth facts/goal/analytics (private until explicit owner action). No public developer leaderboard.
