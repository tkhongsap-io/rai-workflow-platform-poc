# ADR 0002: local execution of the authored design

2026-09-21. Accepted for Ta's synthetic local-demo request, not production stack decision D04.

Reuse the exact exported Main.dc.html template, CSS and Component logic. Preserve the unmodified export under demo/reference. The hosted support.js runtime is not portable, so demo/runtime.js implements only the bindings used by this artifact: properties, state redraw, dotted-path interpolation, conditional/repeated nodes and event handlers. The entry HTML changes only the runtime script and viewport metadata. The adapter compiles trusted repository component source, never form input. Option labels use native text nodes; wrapping them in spans made native selects blank and was corrected during browser verification.

Python 3 serves only demo/ on loopback. No CDN, npm runtime dependencies, build step, credentials or cloud API. Node's built-in test runner exercises the actual component from demo/index.html. Browser test functions use the Playwright locator API and can run through Codex's supported browser surface.

State is in memory, matching the design; reload resets it. Role switching is a demonstration control, not authentication. Modal dialogs are authored DOM overlays, not native dialogs. Real authorization, persistence, uploads, concurrency and integrations remain unimplemented. The fixed outer presentation canvas is fitted to the browser; authored device previews remain 1440, 834 and 390 pixels wide. This preserves the approved presentation rather than redesigning it as a new responsive application.

The earlier independent reconstruction is not shipped. Its unused files were preserved outside the repository in /tmp/rai-pre-export-draft before replacement.
