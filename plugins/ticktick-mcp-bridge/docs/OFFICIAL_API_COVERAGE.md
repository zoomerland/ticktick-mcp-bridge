# Official TickTick API Coverage

This bridge follows the public TickTick Open API documented at:

```text
https://developer.ticktick.com/docs/index.html
https://developer.ticktick.com/docs/openapi.md
```

As of this implementation, common machine-readable Swagger/OpenAPI paths on `developer.ticktick.com` return 404:

```text
/openapi.json
/swagger.json
/v3/api-docs
/docs/openapi.json
/docs/swagger.json
/api-docs
/open/v1/swagger.json
```

If TickTick later publishes a JSON/YAML OpenAPI spec, prefer generating this coverage document and schema tests from that source.

## Implemented Official Groups

Task:

- `GET /open/v1/project/{projectId}/task/{taskId}`
- `POST /open/v1/task`
- `POST /open/v1/task/{taskId}`
- `POST /open/v1/project/{projectId}/task/{taskId}/complete`
- `DELETE /open/v1/project/{projectId}/task/{taskId}`
- `POST /open/v1/task/move`
- `POST /open/v1/task/completed`
- `POST /open/v1/task/filter`

Project:

- `GET /open/v1/project`
- `GET /open/v1/project/{projectId}`
- `GET /open/v1/project/{projectId}/data`
- `POST /open/v1/project`
- `POST /open/v1/project/{projectId}`
- `DELETE /open/v1/project/{projectId}`

Focus:

- `GET /open/v1/focus/{focusId}`
- `GET /open/v1/focus`
- `DELETE /open/v1/focus/{focusId}`

Habit:

- `GET /open/v1/habit/{habitId}`
- `GET /open/v1/habit`
- `POST /open/v1/habit`
- `POST /open/v1/habit/{habitId}`
- `POST /open/v1/habit/{habitId}/checkin`
- `GET /open/v1/habit/checkins`

## Not Implemented As First-Class Tools

No official Open API endpoint is currently documented for:

- Countdown
- Calendar subscriptions
- Eisenhower Matrix

These may be derived from normal task fields in a separate experimental layer, but they should not be presented as direct TickTick module synchronization.
