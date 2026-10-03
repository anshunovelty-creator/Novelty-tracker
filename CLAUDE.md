# label-print-tracker

Production job tracker for a label printing business: authenticated admin panel (5 departments, 15-stage pipeline, QC, dispatch, machines) plus a public client tracking portal at `/track`. Next.js 14 App Router, Tailwind v3, Supabase, GSAP.

## Design Context

Read these before any UI work:

- **PRODUCT.md** (project root): register (`product`), platform (`web`), users, brand personality, anti-references, and the five design principles (status is the product; premium means precision; one vocabulary, two audiences; fast on the floor; states are designed).
- **DESIGN.md** (project root): the visual system, "Control Room". Light "Airy Green" admin (white cards on #F4F7F5) and Press Green glass for /track and /display; DM Sans for words, Trispace for numbers; a state is a stage-coloured dot + its name (`STAGE_DOT` in statusColors.ts), never a filled pill or tinted row. Frontmatter tokens are normative; the browsable reference is the Control Room design system artifact linked there.

Anti-references to honor in all UI work: no generic admin-template grammar, no consumer-app flashiness. WCAG AA, 44px tap targets, `prefers-reduced-motion` alternatives everywhere.
