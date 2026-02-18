# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in delivery-intel, please report it responsibly.

**Do not open a public issue.**

Instead, email [parthiban.rajasekaran@outlook.com](mailto:parthiban.rajasekaran@outlook.com) with:

- A description of the vulnerability
- Steps to reproduce it
- Any relevant logs or screenshots

You should receive an acknowledgment within 48 hours. We'll work with you to understand and address the issue before any public disclosure.

## Security Practices

- **No credentials stored in code** — delivery-intel never persists tokens. It reads them from environment variables or the OS keychain via `gh auth token`.
- **Minimal permissions** — Only read access to repos, actions, and pull requests is required.
- **Dependency scanning** — We run `npm audit` in CI and use OSV.dev for vulnerability checks.
- **Pinned dependencies** — Lock files are committed and reviewed.
