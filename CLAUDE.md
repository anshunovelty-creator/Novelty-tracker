# novelty-labels-tracker

Production job tracker for a label printing business: authenticated admin panel (5 departments, 15-stage pipeline, QC, dispatch, machines) plus a public client tracking portal at `/track`. Next.js 14 App Router, Tailwind v3, Supabase, GSAP.

## Design Context

Read these before any UI work:

- **PRODUCT.md** (project root): register (`product`), platform (`web`), users, brand personality, anti-references, and the five design principles (status is the product; premium means precision; one vocabulary, two audiences; fast on the floor; states are designed).
- **DESIGN.md** (project root): the visual system. North Star "The Control Room": dark glass panels over the Press Green mesh, DM Sans/DM Mono, translucent status chips, translucency-first elevation. Frontmatter tokens are normative.

Anti-references to honor in all UI work: no generic admin-template grammar, no consumer-app flashiness. WCAG AA, 44px tap targets, `prefers-reduced-motion` alternatives everywhere.
