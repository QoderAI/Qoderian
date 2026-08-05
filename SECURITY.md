# Security Policy

## Supported versions

Security fixes are applied to the latest released version of Qoderian. Users
should update both Qoderian and qodercli before reporting an issue that may
already have been fixed.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include secrets,
private vault content, access tokens, or unredacted logs in a public report.

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Select **Advisories** and **Report a vulnerability**.
3. Include affected versions, reproduction steps, impact, and a minimal
   redacted example.

If private vulnerability reporting is not yet enabled, contact the repository
maintainers privately before sharing technical details.

## Credential handling

Qoderian does not contain or request a Qoder API key. Authentication is owned
by the locally installed qodercli.

Users may optionally configure third-party MCP credentials, private gateway
tokens, or custom environment variables. These values are stored as ordinary
text in the vault configuration. Keep the corresponding files out of version
control and untrusted sync services, and redact them from bug reports.
