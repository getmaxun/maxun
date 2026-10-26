# Security Policy

Thank you for helping keep Maxun secure. We appreciate responsible disclosure of security vulnerabilities.

## Reporting a Vulnerability

If you believe you have discovered a security vulnerability in Maxun, please report it by emailing **[support@maxun.dev](mailto:support@maxun.dev)** with the following information, if possible:

* A description of the vulnerability.
* Steps to reproduce the issue.
* The affected component(s) and version(s).
* Any proof-of-concept code or screenshots that help demonstrate the issue.
* The potential impact of the vulnerability.

Please **do not** report security vulnerabilities through public GitHub issues or discussions.

## Maxun OSS: Deployment and Security Scope

The Maxun OSS version is designed for trusted, local environments and does not implement per-user resource isolation. It is not intended to function as a multi-tenant system with strict account separation.

In this distribution, all users are assumed to operate within the same trusted environment, and shared access to robots, runs, and recordings is expected behavior. As a result, the absence of `userId` scoping in resource queries is intentional and is not considered a security vulnerability within the scope of the OSS project.

Security researchers are welcome to report other potential vulnerabilities in Maxun OSS. However, reports concerning the absence of per-user resource isolation or multi-tenant support in OSS are out of scope. If you identify a potential cross-tenant vulnerability in Maxun Cloud, please report it through the security reporting channel above.


## Response Timeline

Maxun is maintained by a small team, and we receive a high volume of emails every day. While we review every legitimate security report, we may not be able to respond immediately.

* We aim to acknowledge security reports within **5 business days**.
* Valid reports will be investigated and addressed as appropriate.
* We may reach out if we need additional information to reproduce or verify the issue.

Please avoid sending repeated follow-up emails before the acknowledgment window has passed, as this does not expedite the review process.

## Responsible Disclosure

We kindly ask that you:

* Give us a reasonable amount of time to investigate and remediate the issue before making it public.
* Do not publicly disclose vulnerability details until we have had an opportunity to address them.
* Avoid accessing, modifying, or deleting data that does not belong to you.
* Avoid disrupting the availability or integrity of Maxun services while testing.

## Bug Bounty

**Maxun does not currently operate a bug bounty or vulnerability reward program.**

We sincerely appreciate responsible security research and vulnerability reports. However, we are unable to provide financial rewards, bounties, or guaranteed public recognition for submitted reports.

## Scope

This policy applies to:

* The Maxun open-source project
* Maxun Cloud
* Official Maxun websites and documentation

Third-party services and dependencies are outside the scope of this policy unless the issue is specific to Maxun's implementation.

Thank you for helping us improve the security of Maxun.
