# Approved carousel studio implementation

The user approved the written specification and production implementation on October 1, 2026. The independent specification review passed. The writing-plans skill is not installed; this plan records the required implementation sequence directly.

1. Reconcile the release checkout and production scope; preserve unrelated files.
2. Provision the requested Editor identity without bypassing email verification; verify membership, do not impersonate the recipient or change provider settings.
3. Test-first implement the strict carousel contract, eight-photo baseline, field defaults/overrides, roles and bilingual publish validation.
4. Add a site-scoped immutable aggregate/revision/command/history model, authenticated routes and safe media projection. Verify concurrency and tenant isolation.
5. Integrate carousel snapshots into existing recovery generations and workers; fail closed on incomplete publication preparation. Test primary-store outages and unrelated publications.
6. Implement Visual Studio A and shared public/preview renderer with faithful baseline framing, reduced motion, no autoplay and explicit review/publish.
7. Verify focused/full tests, type/lint, database boundaries, preview UI at desktop/tablet/mobile and both languages. Run staged nonproduction mutations only.
8. Publish additive migrations and the checked release, seed only the real approved baseline, enable authoring only after recovery verification, then verify canonical production and report limitations.

No package-profile publication, provider changes, synthetic constituent data, or destructive cleanup is included. Access provisioning is a separate operational completion item. If a genuine release blocker is found, preserve completed work and report it rather than publishing a partial unsafe feature.
