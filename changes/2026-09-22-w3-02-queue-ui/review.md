# W3-02 local review

## First commit: UI contract

Additive Thai/English queue labels, ROUTES.queue, API_PATHS.queue and typed getQueue(QueueQuery): Promise<QueueResponse>. The shared API schema is unchanged. No screen, router or navigation behavior change in this prerequisite commit.

Node24, own npm ci. Typecheck, focused ESLint and 20 client/route/locale unit tests passed; git diff --check and repository link check passed. Log: /tmp/rai-w3-ui-contract-check.log. Parent may publish this commit as the separate prerequisite contract PR. W3-08 PR108 must also land before consumer delivery.

## Implementation

Pending in the second commit. Substitute verification only; real-server wiring and acceptance belong to W3-INT.
