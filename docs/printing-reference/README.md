# Printing reference — box slips & roll slips

Drop-zone for the photos and screenshots behind the "print slips from our own
software instead of BarTender" work. Everything here is **input for design**, not
part of the app.

**The images are gitignored, this README is not.** Sample slips carry real party
names, PO numbers and quantities — same rule as the `*.xlsx` intake sheets. Put the
files in, they stay local; the folder structure and these notes travel with the repo.

One narrow exception, listed by name in `.gitignore`: the two
`02-bartender/template-*.jpeg` canvas shots. They are blank templates — `<Empty>`
in every data field, no party, no PO, no quantity — so the reason for the rule
does not reach them, and `RollSlipCompactLabel.tsx` is hard to read without the
layout it reproduces. Anything with real data on it stays local, no exceptions.

Any image format is fine (`.jpg`, `.png`, `.heic`, `.pdf`). Don't bother renaming —
just drop them in the right folder and tell me they're there.

---

## `01-printer/` — the TSC machine

What I need to work out the command language, resolution and label limits.

- [ ] The **model/spec plate** — usually a sticker on the back or underside.
      The model number is the one thing I can't guess (TTP-244 Pro, TE244,
      TTP-345, MH241… they differ in dpi and max width).
- [ ] The printer as it sits on the floor, with the stock loaded.
- [ ] **How it's connected** — photo of the cable going into the back. USB,
      Ethernet, or serial changes the whole integration path.
- [ ] If Ethernet: its IP address (from the config printout or Windows).

> Why it matters: 203 dpi vs 300 dpi decides how sharp a barcode renders, and
> USB vs Ethernet decides whether the print can be fired straight from a browser
> tab or needs a small helper running on the PC.

## `02-bartender/` — the software side

- [ ] **Help → About** in BarTender — I need the **edition and version**
      (Professional / Automation / Enterprise). This decides whether triggering
      BarTender from our app is even licensed, or whether we replace it.
- [ ] The label design open in the BarTender designer, showing the layout canvas.
- [ ] The **print dialog** you use day to day — which printer, how many copies.
- [ ] If the data comes from a database/Excel connection, a shot of that setup.
- [ ] Roughly how many slips get printed on a busy day.

## `03-box-slips/` — samples

- [ ] A **printed box slip**, flat, straight on, well lit — one that's fully
      filled in with real data.
- [ ] A second one from a **different job**, so I can tell which fields are
      fixed labels and which are variable data.
- [ ] The slip **stuck on an actual box**, so I can see placement and size.
- [ ] If there's a barcode on it: does anything **scan** it later? Note it here
      or just tell me.

## `04-roll-slips/` — samples

Same three shots as above, for the roll slip.

- [ ] A filled-in printed roll slip, flat and straight on.
- [ ] One from a different job.
- [ ] The slip **on the roll**, in place.

## `05-label-stock/` — the blank media

- [ ] The blank label stock the slips print on.
- [ ] **The size**, measured — width × height in mm. A photo with a ruler or
      measuring tape beside it is perfect. Also whether it's a gap label, a
      black-mark label, or continuous.
- [ ] The core/roll the blank stock comes on, if there's a spec sticker on it.

---

## Questions I still need answered in words

Photos won't tell me these — answer them here, or just reply in chat:

1. **Who fills the slip in today** — Postpress at packing, or Dispatch?
2. **When** is it printed — as each roll comes off slitting, or all at once when
   the box is sealed?
3. **What's on it that the app doesn't know yet?** Roll numbers, meters per roll,
   labels per roll, box number, gross weight — the app currently tracks nothing
   below `print_runs.qty_this_run`, so every field on the slip that isn't PO /
   party / job name / quantity is data we'll need to start capturing.
4. Does the **customer** require a specific slip format, or is this our own?
5. Anything about the current process that's **annoying** — retyping, wrong
   counts, reprints. Those are the bits worth fixing while we're in here.

---

Once the folder's populated, say so and I'll read through everything and come
back with the data model plus the print approach, matched to your actual layout.
