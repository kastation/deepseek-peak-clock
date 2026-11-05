# DeepSeek Peak Clock

A small ambient widget under the message composer that answers three questions:

- **What is my local time?** A live clock in the browser's local time zone.
- **Is DeepSeek peak or off-peak right now?** A colored status dot and label.
- **When does the rate change?** A live countdown to the next peak or off-peak window.

## Rate schedule

DeepSeek's published API pricing defines peak hours as **Mon–Fri, 01:00–04:00 and
06:00–10:00 UTC**, excluding Chinese public holidays. Everything else — nights,
weekends, and holidays — is off-peak.

Source: <https://api-docs.deepseek.com/quick_start/pricing>

Both peak windows land on the same Beijing calendar date as their UTC date
(09:00–12:00 and 14:00–18:00 Beijing), so holiday lookup uses the UTC date.

## Holiday calendar

The 2026 Chinese public holidays are bundled from the State Council notice
国办发明电〔2025〕7号:

Source: <https://www.gov.cn/zhengce/content/202511/content_7047090.htm>

When the notice for the next year is published, extend
`CHINESE_HOLIDAY_RANGES_2026` in `client.js` and rename the table accordingly.
Make-up working weekends listed in that notice remain off-peak here, because
the API rule says Monday through Friday, not "official working days".

## Where it renders

The widget registers in `conversation.composer.dock`, beside the existing
ambient entries below the composer (it appears once a conversation session is
open). It follows the active Harness locale (English and Simplified Chinese
dictionaries ship in `client.js`) and the host theme through `--dsw-alias-*`
tokens.

## Files

| File | Purpose |
| --- | --- |
| `client.js` | Clock, peak/off-peak computation, countdown, styles |
| `index.js` | Empty Host half that claims the Loader row |
| `cordis.patch.yml` | Inserts the `deepseek-peak-clock` row |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title/description |
| `icon.svg` | Plugin icon |

## Notes

- Time formatting follows the browser locale (12-hour vs 24-hour), so the clock
  matches the rest of the operating system.
- The countdown updates on second boundaries and is recalculated from
  `Date.now()` on each tick, so sleep/wake and clock changes self-correct.
- The widget is read-only: it has no host-side behavior and stores nothing.
