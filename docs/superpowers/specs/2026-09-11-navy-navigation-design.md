# Navy navigation

## Approved direction

Match the shared site navbar to the existing homepage hero navy, `#1e3353`. The user requested this change and previously instructed us to proceed with recommended decisions without repeated approval prompts. Preserve header dimensions, sticky behavior, routes, editor identifiers, locale handling, and menu interactions.

An opaque navy surface is selected because it matches the hero regardless of the page scrolled underneath. A translucent surface would vary over content; a gradient would not be an exact match. Neither alternative is needed for this change.

## Scope

Use a shared root color token for the header, hero base, and existing mobile navigation drawer. Keep all global header links and brand text white, including the hamburger icon. Use a subtle outlined language button and a white Contact button with navy text. Add pale hover surfaces and a visible gold keyboard-focus outline. Keep the mobile drawer's current layout, animation, focus management, and high-contrast links. Do not recolor other page buttons, alerts, editor controls, or content.

## Plan and verification

1. Add failing CSS contract tests for the shared color, scoped header contrast, contact action, and keyboard focus.
2. Make the minimal global CSS and hero-token changes; no component behavior changes or new dependencies.
3. Run the new tests and existing mobile navigation, carousel, and homepage tests. Confirm text/background contrast numerically.
4. Stage a production-target deployment without moving public domains. Keep newsletter readiness checks intact.
5. Verify desktop and phone rendering, language switching, menu open/close, keyboard focus, and navigation to an inner page. Promote only after passing; verify the public site and push the scoped source changes without altering the original dirty checkout.

The writing-plans skill is not installed; the bounded implementation sequence above is the fallback. No provider changes, form submissions, or email sends are part of this change.
