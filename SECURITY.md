# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through [GitHub Security Advisories](https://github.com/stretchcloud/deepscrape/security/advisories/new), which lets us work on a fix before disclosure.

Expect an acknowledgement within 72 hours and an assessment within 7 days. If a fix is warranted we'll agree a disclosure timeline with you, and credit you in the advisory and release notes unless you'd rather we didn't.

## Supported versions

The latest release on `main`. This project does not currently backport fixes.

## Scope

DeepScrape fetches URLs supplied by its operator and executes browser automation, so the interesting attack surface is anything that crosses that boundary:

**In scope**

- SSRF — bypassing the DNS-resolving guard on any fetch or redirect hop, including reaching private ranges or cloud metadata endpoints
- Authentication or authorisation bypass on API keys, rate limits, or per-key quotas
- Injection through scraped content into extraction output, stored sessions, or MCP tool definitions
- Path traversal via export, ZIP download, or cache paths
- Sandbox escape from the Playwright browser context
- Secrets leaking into logs, error responses, or cached artefacts
- Denial of service through crawl limits, ReDoS in include/exclude patterns, or queue exhaustion

**Out of scope**

- Anything requiring an already-compromised host or a malicious operator — DeepScrape trusts whoever runs it
- Missing hardening on a deployment the operator chose to expose without an API key
- Rate limiting on a self-hosted instance the reporter controls
- Vulnerabilities in target websites reached through DeepScrape
- Automated scanner output with no demonstrated impact

## A note on responsible use

This is a scraping tool. It respects `robots.txt` and does not solve CAPTCHAs, and we'd ask that you don't use it to gather data you don't have permission to gather.
