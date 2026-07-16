# Anclas Port public data

Public JSON data feed and generation pipeline used by the Anclas Port iOS app.

The files in this repository are generated automatically from publicly available league and club information. The pipeline runs hourly on GitHub Actions. The iOS application source code is maintained in a separate private repository.

## Files

- `matches.json` — match schedule and results
- `standings.json` — league standings
- `players.json` — player profiles
- `partners.json` — official partner information

Do not edit the JSON files manually. They are overwritten by the data pipeline.

## Pipeline

- `scripts/` contains the TypeScript parsers and tests.
- `.github/workflows/data-pipeline.yml` runs hourly and can also be started manually.
- Generated JSON is committed directly to this repository for unauthenticated app access.
Public JSON data feed for the Anclas Port iOS app
