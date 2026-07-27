SELECT status,
    log,
    "startedAt",
    "finishedAt"
FROM "run"
ORDER BY "startedAt" DESC
LIMIT 1;