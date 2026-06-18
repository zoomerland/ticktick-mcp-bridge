# Security

This is a self-hosted TickTick MCP server. Treat it as a private control surface for your tasks.

## Secrets

Never commit:

- `.env`
- `data/`
- `auth.json`
- TickTick OAuth client secrets
- TickTick access or refresh tokens
- `APP_SHARED_SECRET`

The repository only includes `.env.example` placeholders.

## Authentication

If the HTTP transport is reachable from the internet, set:

```text
APP_SHARED_SECRET=<long-random-value>
```

Clients must then send:

```text
Authorization: Bearer <long-random-value>
```

Do not expose the HTTP server publicly without authentication. The server includes write tools that can create, update, complete, and delete TickTick tasks.

## OAuth Model

This project is not a hosted multi-tenant SaaS. Each user should run their own instance and authorize their own TickTick account.

Tokens are stored in the user's local machine or private deployment storage. If you deploy this on a VPS or free hosting provider, that server becomes the token storage location.

## Reporting Issues

If you find a security issue, do not open a public issue with secrets or exploit details. Contact the repository owner privately.
