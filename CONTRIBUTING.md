# Contributing

Open an issue describing the workflow problem and a small reproduction. For changes, include the intended behavior, tests, and any effect on pricing or accounting.

Use a virtual environment and install `.[dev]`. Run `python -m pytest -q` and `pnpm build`. Never commit `.env`, API keys, databases, user traces, or provider responses. Add provider adapters with mocked responses and explicit pricing versions. Do not run paid integration tests by default.

Accounting invariants: reservations are atomic, amounts use integer nanodollars, usage settlement is idempotent, uncertain provider outcomes retain their hold, and overages remain visible. Do not silently release funds on a timeout.

This project has no public GitHub remote yet. Once published, use that repository's issue tracker and pull requests.
