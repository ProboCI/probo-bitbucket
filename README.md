# Probo Bitbucket Handler

A webhook integration service that connects Bitbucket to the Probo CI system. It receives Bitbucket webhooks (pull requests, pushes), fetches `.probo.yml` from the repo, submits builds to the Probo API coordinator, and posts build statuses back to Bitbucket.

## Installation

```bash
npm install
```

## Configuration

Configuration is loaded via `yaml-config-loader` in priority order (last wins):

1. `defaults.yaml` (base defaults)
2. Environment variables
3. CLI arguments
4. Custom YAML config file (via `-c` flag)

### Required Config Keys

| Key | Description |
|-----|-------------|
| `bbClientKey` | Bitbucket OAuth consumer key |
| `bbClientSecret` | Bitbucket OAuth consumer secret |
| `bbAccessToken` | OAuth access token |
| `bbRefreshToken` | OAuth refresh token |

### Optional Config Keys

| Key | Default | Description |
|-----|---------|-------------|
| `port` | `3012` | Server listen port |
| `hostname` | `0.0.0.0` | Server hostname |
| `bbWebhookUrl` | `/bitbucket-webhook` | Webhook endpoint path |
| `api.url` | `http://localhost:3020` | Probo coordinator API URL |
| `api.token` | | API token (enables coordinator mode) |

### Example Config File

```yaml
port: 3012
bbClientKey: your-consumer-key
bbClientSecret: your-consumer-secret
bbAccessToken: your-access-token
bbRefreshToken: your-refresh-token
api:
  url: "http://localhost:3020"
  token: your-api-token
```

## Usage

```bash
# Start with a config file
./bin/probo-bitbucket-handler -c config.yaml

# Start with dev config (piped through bunyan for readable logs)
npm start

# Start with nodemon for auto-reload during development
npm run startdev
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/bitbucket-webhook` | Receives Bitbucket webhook events |
| `POST` | `/builds/:bid/status/:context` | Build status updates from Probo |
| `POST` | `/update` | Alternative status update endpoint |
| `POST` | `/builds/hash` | Trigger build from a commit hash |
| `GET` | `/pull-request/:owner/:repo/:pullRequestNumber` | Fetch PR info |
| `GET` | `/auth_lookup` | OAuth2 token refresh |

## Testing

```bash
npm test
```

Tests use [mocha](https://mochajs.org/) with [should](https://shouldjs.github.io/) assertions and [nock](https://github.com/nock/nock) for HTTP mocking.

## Docker

```bash
docker build -t probo-bitbucket .
docker run -p 3012:3012 -v /path/to/config.yaml:/etc/probo/bitbucket-handler.yaml probo-bitbucket
```
