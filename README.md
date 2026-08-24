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
- `manual-matches.json` — manually managed cup-competition fixtures

The pipeline overwrites all JSON files except `events.json` and
`manual-matches.json`. Edit `events.json` when adding or changing a
limited-time announcement. Edit `manual-matches.json` for cup fixtures (see
below).

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

## Cup fixtures

`matches.json` normally comes from scraping the Q-League official site, which
only lists league matches. Knockout cup competitions (such as the Empress's
Cup regional qualifiers) are not on that site because opponents come from
other prefectures and leagues. Add or update fixtures in `manual-matches.json`
instead; `generate-matches.ts` merges them into `matches.json` on every run,
so they appear in the schedule and become the Home screen's next match once
they are the closest upcoming date.

```json
{
  "matches": [
    {
      "id": "unique-match-id",
      "competition": "皇后杯 1回戦",
      "date": "2026-09-12",
      "kickoff": null,
      "homeTeam": "福岡J・アンクラス",
      "awayTeam": "Opponent name",
      "status": "scheduled",
      "score": null,
      "venue": "Venue name",
      "sourceUrl": "https://example.com/bracket"
    }
  ]
}
```

`competition` carries the round together with the tournament name (there is
no separate round field for cup matches), so the app can show it as-is —
`"皇后杯 1回戦"`, then `"皇后杯 2回戦"`, and from the semifinal onward
`"皇后杯 準決勝"` / `"皇后杯 決勝"`.

Use `scripts/src/advance-cup-match.ts` to add the next round once a result is
known (see its file header for usage).

## Pipeline

- `scripts/` contains the TypeScript parsers and tests.
- `.github/workflows/data-pipeline.yml` runs hourly and can also be started manually.
- `.github/workflows/validate-events.yml` validates event edits in pull requests.
- Generated JSON is committed directly to this repository for unauthenticated app access.
