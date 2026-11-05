# Private live-API fixtures

These files are deliberately gitignored. Never commit parcel labels, phone
numbers, recipient details, API credentials, or the generated live report.

Required files for `npm run test:live` / `npm run test:release`:

- `courier-test-original.jpg`: actual test photo, parcel held beside blue plate 32.
  Expected: wrong location under the configured destination, never doorstep proof.
- `old-label.jpg`: old destination on a parcel label. Never destination authority.
- `wrong-entrance.jpg`: actual entrance photo with blue plate 32.
- `prompt.json`: `{ "prompt": "..." }`, the exact candidate deployment system prompt.
  The positive control temporarily changes the plate criterion from 11 to 32;
  no deployed configuration is changed by the test.

The local `.env` one directory above `test/` supplies `OPENAI_API_KEY`.
The harness aborts if a credential or fixture is missing; it never skips.
It calls the real Responses API, verifies model/effort, checks actions, and grades
free-form replies semantically. A known-bad answer checks the grader itself.
No WhatsApp client, gate action, OTP store, or messaging executor is imported.

These paid API tests are required before EVERY release, including rebuilds.
See `RELEASING.md` at the repository root.
