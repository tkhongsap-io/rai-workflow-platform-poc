# Evidence contract

- OBS-03: a generated, reachable, unmigrated database yields actual HTTP /readyz 503 with store.db=ok and migrations=pending. A migrated fixture database yields 200. A closed loopback DB port yields 503 unreachable while /healthz remains 200, including a session cookie obtained from the healthy real server.
- OBS-15: exercise successful fixture sign-in, search for a fixture person's name, and a Thai-named PDF upload over HTTP. Require correlated request completion and relevant safe domain events; apply existing assertNoLeak to all captured stdout/stderr lines through shutdown, including session and encoded-query canaries.
- This is process coverage for these scenarios, not proof of suite-wide W1-W3 OBS-15. Final combined suite capture and acceptance stay with parent.
- No fake operator responses, new production flags, external identity/mail, or invented QC acceptance.
