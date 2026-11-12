# Technical Literature, Standards and Project References

> **Kadmeion planning artifact · 12 November 2026 · NOT IMPLEMENTED.** `[APPROVED]` = explicit owner choice; `[PROPOSED]` = specification or architecture suggestion; `[PROOF]` = requires technical/test evidence. No code, deployment, integration, screenshots or performance claims are implied.

## Reading strategy and evidence hierarchy

Use peer-reviewed/HCI foundational sources to motivate usability and privacy design, **current official standards/vendor documentation** for runtime constraints, and actual capstone experiments for evaluation. The project has not yet conducted independent empirical user research. Do not label product comparisons or synthetic fixture counts as user-study findings.

## Primary standards and technical documentation (consulted as public reference, not integration proof)

1. W3C. *Web Content Accessibility Guidelines (WCAG) 2.2*. https://www.w3.org/TR/WCAG22/ — accessibility design target and test criteria.
2. OWASP. *Application Security Verification Standard (ASVS)*. https://owasp.org/www-project-application-security-verification-standard/ — security verification framework; actual version must be recorded when used.
3. OWASP. *Server-Side Request Forgery Prevention Cheat Sheet*. https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html — risks and controls for remote thumbnail capture.
4. Supabase. *Row Level Security*. https://supabase.com/docs/guides/database/postgres/row-level-security — actual grants/policies require project-level tests.
5. Supabase. *Send emails with custom SMTP*. https://supabase.com/docs/guides/auth/auth-smtp — default sender restrictions, selected Brevo requires real validation.
6. MDN. *File System Access API: Window.showDirectoryPicker*. https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker — browser adapter compatibility.
7. MDN. *Storage quotas and eviction criteria*. https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria — local browser persistence is not guaranteed.
8. MDN. *Content-Security-Policy sandbox directive*. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox — one part of custom code isolation, not proof by itself.
9. Cloudflare. *Workers limits*. https://developers.cloudflare.com/workers/platform/limits/ — candidate free-host resource limits, as of Nov 2026, subject to change.
10. Kadmeion owner. *Final Portfolio Builder/Editor Blueprint*, version 1.0, 12 Nov 2026. Internal planning source archived in `sources/`, 1,647 lines; not an external published article.
11. Kadmeion owner. *UI/UX Interview Decisions UI-001–115*, Nov 2026. [Private Notion decision record]([private Notion decision record — not publicly linked]). Owner specifications, not published research.

## Foundational literature to verify for academic reference list before submission

- Norman, Don. *The Design of Everyday Things* (revised/expanded edition). Publisher, year and selected chapter/page **to verify from accessible book** before citing quotations.
- Nielsen, Jakob. *Usability Engineering* (1993). Exact edition/page **to verify** before academic in-text citation.
- Saltzer, Jerome H., and Michael D. Schroeder. “The Protection of Information in Computer Systems” (1975). Verify journal/bibliographic details and DOI before formal references.
- W3C. *WAI-ARIA Authoring Practices Guide*. https://www.w3.org/WAI/ARIA/apg/ — keyboard patterns and semantic roles.
- ISO/IEC 25010 quality model. Verify exact licensed standard edition/access and permissible citation before relying on exact normative table text.

## Research comparison framework (future)

Compare conventional static template authoring, visual editors, source-first React portfolios and full-stack profile aggregators on: author skill requirement, round-trip source integrity, custom component ownership, accessible editor interactions, publish/revoke/SEO, portability, cost and identity/privacy. Record actual source/version and reproduction data; no invented competitor benchmark scores.

## Reference integrity rule

All linked web documentation may change; cite access dates and archive relevant permissible excerpts when doing actual capstone experiments. Do not claim a peer-reviewed evaluation supports Kadmeion's performance without an actual cited experiment.
