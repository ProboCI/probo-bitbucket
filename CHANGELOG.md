# Changelog

All notable changes to the Probo Bitbucket Handler are documented in this file.

## [Unreleased]

### Added
- Skip `pullrequest:updated` webhook events when the commit hash has not changed, preventing unnecessary builds from non-code PR updates (e.g. adding reviewers, editing descriptions).
- Bitbucket API client refactored into `BitbucketApi` class with token refresh callback to fix multi-user authentication issues.

### Fixed
- Fixed multi-user authentication bug where the first user's OAuth token was used for all subsequent users.

## [2.0.1] - 2022-03-20

### Changed
- Updated license from Proprietary to Apache-2.0.
- Version bump to 2.0.1.

### Added
- Push events now trigger builds only when commit message contains `[build]`.
- Build script added to bin directory.

## [2.0.0] - 2021-09-08

### Changed
- Updated to Node.js 12.
- Updated version to 2.0.0.
- Major dependency updates: async 3.x, bluebird 3.x, superagent 5.x, yargs 16.x, mocha 8.x, nock 13.x, eslint 7.x, should 13.x, yaml-config-loader 2.x.
- Updated packages for security vulnerabilities.

### Added
- Docker support with Dockerfile and startup scripts for containerized deployment.
- Microservices startup sequence.

## [1.3.1] - 2019-07-11

### Fixed
- Applied whodunit patch to fix API YAML handling (PB-644).

## [1.3.0] - 2016-12-28

### Added
- `running` state mapped to Bitbucket `INPROGRESS` status.

### Fixed
- `pending` state now correctly maps to `INPROGRESS` instead of `PENDING`, which Bitbucket does not accept.

## [1.2.0] - 2016-06-20

### Added
- HTTP endpoint for loading pull request data (`GET /pull-request/:owner/:repo/:pullRequestNumber`).
- CLI help output via `--help` flag.

### Changed
- `BitBucketWebhookHandler` converted to ES6 class syntax, replacing deprecated `__proto__` usage.
- Executable runs Node directly without wrapper script.
- ESLint configuration updated; api.js brought into compliance.
- Code cleanup, linting, and naming improvements throughout.

## [1.0.1] - 2016-04-15

### Fixed
- Proper handling of `key` and `name` fields for Bitbucket status updates (PB-202).
- Improved error handling and logging.
- Sensitive data no longer logged.

## [1.0.0] - 2015-12-03

### Added
- Bitbucket webhook handler for pull request events (`pullrequest:created`, `pullrequest:updated`).
- OAuth2 authentication with automatic token refresh.
- Build status posting to Bitbucket with state mapping (success, pending, error, fail).
- Commit status key truncation to 40 characters (Bitbucket API requirement).
- Status update queue with concurrency of 1 to prevent race conditions.
- `.probo.yml` config file fetching from Bitbucket repositories.
- `/auth_lookup` endpoint for OAuth token refresh.
- Probo coordinator API client with Container Manager fallback.
- Nock-based test infrastructure with HTTP record/playback.
- Configuration via YAML files, environment variables, and CLI arguments.

## [0.1.0] - 2015-06-11

### Added
- Initial commit as Stash handler, later renamed to Bitbucket.
- Basic webhook handling and status updates.
- HTTP request logging.
- Test suite with mocked HTTP calls.
