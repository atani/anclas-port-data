# Anclas Port public data

Public JSON data feed and generation pipeline used by the Anclas Port apps.

The files in this repository come from public league and club information.
The pipeline runs hourly on GitHub Actions.
The application source code is maintained in a separate repository.

This repository is the authoritative owner of the production data pipeline,
its JSON schema, and generated feeds. Pipeline changes must be implemented and
released here before or together with client changes. Copies under `scripts/`
or `data/` in the application repository are historical references and are not
production inputs.

## Files

- `matches.json` — match schedule and results
- `standings.json` — league standings
- `players.json` — player profiles
- `partners.json` — official partner information
- `news.json` — club news
- `events.json` — manually managed limited-time announcements

The pipeline overwrites all JSON files except `events.json`. Edit `events.json`
when adding or changing a limited-time announcement.

## Limited-time events

Add an item to `events.json` to place an announcement at the top of the app's
Home screen. The app displays the item from `startsAt` until immediately before
`endsAt`. Both values must be ISO 8601 timestamps with an explicit timezone.

<!-- textlint-disable ja-technical-writing/sentence-length -->

```json
{
  "id": "unique-event-id",
  "title": "Event title",
  "summary": "One-sentence description",
  "imageUrl": "https://example.com/image.jpg",
  "startsAt": "2026-07-22T18:00:00+09:00",
  "endsAt": "2026-08-12T18:00:00+09:00",
  "periodLabel": "開催期間",
  "actionTitle": "詳しく見る",
  "actionUrl": "https://example.com/details",
  "priority": 100
}
```

<!-- textlint-enable ja-technical-writing/sentence-length -->

A larger `priority` places an item before other active events.
The validation rejects duplicate IDs and invalid dates.

It also rejects non-HTTPS URLs and an end time before the start time.

## Pipeline

- `scripts/` contains the TypeScript parsers and tests.
- `.github/workflows/data-pipeline.yml` runs hourly and can also be started manually.
- `.github/workflows/validate-events.yml` validates event edits in pull requests.
- Generated JSON is committed directly to this repository for unauthenticated app access.
