# B1 local authentication verification

Scope: a minimal browser shell for testing Supabase Auth; **not** the finished Kadmeion frontend, publishing flow, or an approved deployment.

## Prerequisites

1. Install Node.js 22.x and run npm ci.
2. Confirm Brevo SMTP is already configured in the Supabase dashboard. A delivered invitation is evidence of SMTP connectivity, not proof of accepted login.
3. Use a Supabase **publishable** key (or legacy anon key), never service_role/secret, SMTP, or Brevo keys.

## Launch on the previously configured Site URL

On Windows PowerShell in the repository root:

    $env:VITE_SUPABASE_URL = "https://scyooqjitjzjdxgtanso.supabase.co"
    $env:VITE_SUPABASE_PUBLISHABLE_KEY = "<YOUR SUPABASE PUBLISHABLE KEY>"
    npm ci
    npm run dev:auth

Open http://localhost:3000 . The web server binds only to 127.0.0.1. Do not expose it to the public internet.

In Supabase Authentication > URL Configuration, set Site URL to http://localhost:3000 and allow explicit redirect URLs:
- http://localhost:3000/auth/callback
- http://localhost:3000/reset-password
- http://localhost:3000/

No wildcard allowlist is required for this local verification. These settings are **dashboard changes by the project owner**, not automated backend changes.

## Acceptance checklist

- Request a new invitation to a test inbox after the server is running. Default Supabase invitation links use an implicit access-token fragment; a supported token_hash template is handled as well.
- Click the invite link; set a 8–128 character password; confirm authenticated placeholder is shown.
- Sign out, sign in with the new password, reload /workspace, and verify the session remains usable.
- Create a fresh account from /register, receive and click email confirmation, then sign in.
- Request password recovery; click link; save a new password; sign out and sign in with new credentials.
- An expired, malformed, or reused invite should not log the user in.
- Inspect browser network traffic for password or token leakage in URL query parameters. Email links may expose a one-time code in fragment; app removes the fragment promptly before verification.

## Limits and warnings

- Browser auth adapter is a narrow B1 proof and is NOT a full substitute for the official Supabase JS client in a production release.
- Google OAuth remains unconfigured and is intentionally disabled rather than pretending to work.
- Persistence uses browser localStorage, matching a common client-side model, but is sensitive to XSS. Review the Content Security Policy and upgrade to the supported official auth client before production.
- All live signup, acceptance, recovery, and redirect checks must be performed interactively. CI only verifies mocked auth contracts and static compilation.
- Do not paste invitation links, access tokens, refresh tokens, passwords, SMTP keys, or private API keys into issue trackers or chat.

## Preview UX and release gate (2026-11-13)

The previous one-column dark engineering form was not the approved Kadmeion authentication interface. The following provisional implementation corrects significant gaps: an Aether Drift light-first split shell, switchable dark mode, reversible 300ms desktop sign-in/register panel movement, direct `/signin`/`/signup` routes and legacy aliases, visible password toggles, confirmation field, normalized @handles with helpful hints, and an 8-character minimum (subject to actual Supabase provider policy). CSS art is an approximation rather than the original K/logo or approved design asset. Exact master token/logo/vector implementation remains an explicit visual acceptance gate. Header/footer labels must not imply full product implementation.

**Critical security hold:** Chrome was reported to display a red “Dangerous” warning for a Vercel preview URL. Do not enter credentials or override Chrome warnings until the exact classification has been independently investigated and corrected. Passing CI, HTTPS, a Vercel READY state, or SSO alone does not invalidate the browser security warning. If users entered reused passwords, rotate them via the affected trusted service.

**Still missing:** verified handle availability and durable claim, complete account onboarding, real invitation/signup/recovery acceptance, OAuth, and browser accessibility/visual regression verification. User-visible success must not assert these are done.
