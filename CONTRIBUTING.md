# Contributing to Knowledge Hub

**English** | [繁體中文](CONTRIBUTING.zh-TW.md)

Contributions are welcome: bug reports, documentation fixes, tests, and feature improvements. Treat others with respect and keep discussions focused on reproducible behavior and concrete suggestions.

## Issues and proposals

When opening a [GitHub issue](https://github.com/mike840609/knowledge-hub/issues), include:

- The problem or use case, including expected and actual behavior.
- Reproduction steps, Node.js and browser versions, operating system, and whether you use Personal or Team mode.
- Relevant errors and screenshots, with passwords, tokens, personal information, and private content removed.

Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md). For substantial features or data model changes, open an issue first to discuss requirements and compatibility.

## Local development

Follow the [quick start](README.md#quick-start), then create a feature branch in your fork. Keep the existing module boundaries: HTTP and UI adapters should access the domain through application services and follow Workspace policy and Source ownership rules.

## Pull requests

1. Keep changes focused and update affected documentation. Add meaningful tests for behavior changes.
2. Run `make verify`. For database, authorization, import, or migration changes, also run `make test-integration`; for user-facing workflows, run the relevant E2E tests.
3. Describe the problem, resulting behavior, test results, and any deployment or migration considerations. Explicitly identify checks you could not complete.
4. Do not commit `.env`, credentials, database dumps, personal data, or test artifacts.

Database upgrades must account for existing data and readiness gates. Explain compatibility implications when changing public APIs or export formats.

By contributing, you confirm that you have the right to provide the content and agree to license it under this project's [MIT License](LICENSE). Retain required attribution and license notices for third-party code or assets.

## Documentation languages

English is the primary language for project documentation. Each Markdown guide has a neighboring `*.zh-TW.md` companion and reciprocal language links below its title. Update both versions when changing documented behavior. Preserve commands, identifiers, test inputs, and historical verification results during translation. Markdown files under `tests/fixtures/` are test data and are excluded from this convention.
