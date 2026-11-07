# On Air

A personal focus system for iPhone. You click a real live flight on Flightradar24, go on air, and finish your sticky before the plane lands.

It runs in the [Scripting](https://scriptingapp.github.io) app. Each day it reads your calendars, lays flights into the gaps, and pings you for Boarding, Descent and Down. Every ping is true whether you flew or not, so nothing has to be tapped or canceled.

To install it, follow [SETUP.md](SETUP.md).

## What's where

| File | Job |
|---|---|
| `tower.ts` | The rules. Turns a day of events into flights and pings. |
| `card.ts` | Every number and every word. |
| `phone.ts` | Calendars, pings and saved data on the iPhone. |
| `index.tsx` | The screens. |
| `intent.tsx` | The morning run from Shortcuts. |
| `dev/` | PC only: tests, a fake phone, a week printer and the wallpaper. |

## Testing

```bash
npm install
node --test
```
