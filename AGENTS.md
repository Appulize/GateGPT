# GateGPT release rules

Follow `/Users/maciekish/AGENTS.md` when available.

Every release and rebuild requires `npm run test:release --prefix gategpt/GateGPT`
on the final candidate tree. This includes the real OpenAI API and private photo
regressions; missing fixtures or credentials are blockers, not reasons to skip.
Read `RELEASING.md` before publishing or deploying. Local-only API credentials,
photos, prompt fixtures and reports must never be committed or uploaded to CI.
Do not replace semantic behavior tests with reply-wording filters. Keep all actual
destination rules in the installation's system prompt, not application code.
