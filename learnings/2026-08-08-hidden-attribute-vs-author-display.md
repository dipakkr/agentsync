# The `hidden` attribute silently loses to any author `display` rule

## The problem

In `src/dashboard/index.html`, elements marked `hidden` (the split-task modal, the
manager-token popover, the two inactive tab panels) all rendered visible on page load,
stacked on top of each other.

## The approach

1. A full-page screenshot showed the modal open and every tab panel stacked; the markup
   clearly had `hidden` on all of them, so the attribute itself was not missing.
2. Checked the CSS for the affected classes: `.pop`, `.backdrop`, and `.panel` all set
   `display:flex`.
3. Pivotal observation: the UA stylesheet rule `[hidden] { display:none }` is a
   user-agent rule. ANY author rule that sets `display` on the same element wins over
   it, regardless of specificity — cascade origin beats specificity.
4. Fix was one line near the top of the stylesheet:
   `[hidden] { display:none !important; }`
   Verified in a real browser (Playwright): modal and popover closed, tab switching
   works, zero console errors.

## The judgment calls

- Did NOT switch the JS to toggle classes like `.open` instead of the `hidden`
  property. The `hidden` attribute is the correct semantic API and every toggle site
  already used it; one CSS guard is a smaller diff than rewriting N toggle sites.
- Did NOT use `dialog`/`popover` elements, which manage their own display. Valid, but
  a larger rewrite of working markup.

## The reusable rule

If a component uses both `element.hidden` and an author `display` rule, add
`[hidden] { display:none !important; }` to the reset — or the hidden state does not
exist. Check this FIRST when "hidden" UI renders anyway.
