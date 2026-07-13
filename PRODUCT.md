# Product

## Register

product

## Platform

web

## Users

Two distinct audiences, one system:

1. **Internal staff (admin panel, authenticated).** Five departments plus admin at a label printing operation. Usage is genuinely mixed: department operators update production stages from the factory floor on phones and tablets, while coordinators and managers work the same screens from office desktops. Their job: move jobs through a 15-stage production pipeline (printing, QC, dispatch, scheduled releases, machine assignment) quickly and without ambiguity about what state a job is in.

2. **Clients (public /track portal, no auth).** Customers of the label company who look up their PO number to see where their order stands. They arrive occasionally, often on mobile, wanting a clear answer to "when do I get my labels?" The portal is also a brand touchpoint: it should leave clients impressed by the operation's professionalism.

## Product Purpose

A production job tracker for a label printing business. It replaces phone calls, WhatsApp threads, and spreadsheet chases with a single source of truth: every job's stage, history, QC status, machine, scheduled releases, and dispatch state. Success looks like (a) floor staff updating stages in seconds from any device, (b) management seeing pipeline health at a glance, and (c) clients self-serving order status instead of calling, and coming away more confident in the company because of how the portal feels.

## Brand Personality

**Premium, polished, modern.** The deep-green glass identity is deliberate, not decoration: this is an industrial tool that carries itself like a flagship product. Precision-crafted surfaces, confident typography (DM Sans / DM Mono), and motion that conveys state. The admin panel earns trust through Linear/Stripe-grade detail; the track portal doubles as a brand statement to clients.

References: **Linear** (crisp, fast, restrained color, impeccable detail) and the **Stripe dashboard** (data-dense but calm, excellent tables and states).

## Anti-references

- **Generic admin templates.** No Bootstrap/AdminLTE energy: no rows of identical stat cards, no default-blue buttons, no off-the-shelf dashboard grammar.
- **Consumer-app flashy.** No playful gradients-for-fun, confetti, or marketing-style motion inside a work tool. The glass-mesh theme is premium restraint, not spectacle; every effect must serve legibility or state.

## Design Principles

1. **Status is the product.** Every screen's first job is answering "what state is this job in, and what happens next?" Stage, health, and time-to-delivery always win the visual hierarchy over chrome.
2. **Premium means precision, not decoration.** The glass identity is executed through alignment, contrast, and consistent component vocabulary. If an effect costs legibility or speed, the effect loses.
3. **One vocabulary, two audiences.** Admin and track share tokens, status colors, and stage language so a client and an operator describing the same job see the same truth, with the portal presented at client-facing polish.
4. **Fast on the floor.** Stage updates are the highest-frequency action: reachable with a thumb, confirmed with immediate feedback, resilient to slow connections. Desktop density never breaks mobile operability.
5. **States are designed, not left over.** Loading (skeletons), empty, error, on-hold, overdue, and partially-dispatched are first-class designs; the unhappy paths are where trust is won.

## Accessibility & Inclusion

WCAG 2.1 AA baseline: ≥4.5:1 contrast for body text (including text over glass surfaces and the mesh background), 3:1 for large text and UI boundaries, full keyboard navigation, visible focus states, and `prefers-reduced-motion` alternatives for all animation (already partially in place: skeleton, mesh-blob, and fade animations disable under reduced motion). Maintain the existing 44px minimum tap targets everywhere; touch is a primary input.
