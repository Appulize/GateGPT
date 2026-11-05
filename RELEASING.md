# Release checks (mandatory)

Before any GateGPT release or image rebuild, including GitHub workflow dispatch:

1. Run `npm run test:release --prefix gategpt/GateGPT` on the exact release tree.
   This runs the unit suite and the real Terra/medium Responses API regression
   suite. Missing credentials/photos, API errors, incorrect model/effort, missing
   written location verdicts, wrong tool actions, and semantic failures block release.
   Do not skip the live suite, weaken assertions to get a green run, or substitute
   mocked responses. Fix regressions and rerun the affected tests.
2. Inspect the private `gategpt/GateGPT/test/live-report.json`. Verify the candidate
   prompt is the exact one intended for deployment. The prompt hash is recorded.
3. Confirm `gategpt/.dockerignore` excludes `.env`, private fixtures, runtime config
   and chat state from the actual Docker build context. Gitignore is not sufficient.
   Review the final diff, run `git diff --check`, and confirm `.env`, private photos,
   the prompt fixture, and test reports are ignored and absent from staged files.
4. Commit on the default branch and publish via the existing Release workflow or
   `gategpt/release.sh`. Both release routes are subject to this preflight.
5. Wait for the multi-architecture image build. Deploy the versioned image, verify
   the published digest, and confirm WhatsApp readiness plus the effective model,
   reasoning effort, prompt hash, and behavior in a send-disabled test.

`gategpt/release.sh` runs the mandatory preflight automatically before any version,
commit, tag, or image change. The GitHub workflow currently runs the offline unit
suite; its manual dispatch additionally requires the local live-photo preflight
above. Do not claim that CI runs private-photo tests until CI credentials and
fixtures are explicitly configured.

Fixtures and their expected outcomes are documented in
`gategpt/GateGPT/test/live-fixtures/README.md`. The API key belongs only in the
ignored local `.env` (0600), never in tracked configuration or logs.
