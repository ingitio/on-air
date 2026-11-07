// Prints a week as a board, so you can read it and cross out what's wrong.
//
//   node dev/board.ts            uses week.txt
//   node dev/board.ts my.txt     uses another file
//   node dev/board.ts my.txt 7   changes the shuffle
//   node dev/board.ts free 13:00 19:00    prints a long day on an empty calendar
//
// week.txt format, one line per thing:
//   MWF 9:05-9:55 Chem          days are M T W Th F Sa Su, run together
//   Tu 12:00-12:45 Gym          anything you can't fly through counts
//   Sa off                      shuts the airport that day
// Times under 8 are read as pm (2:30 means 14:30). 24-hour times work too, and a
// leading zero (07:30) always means morning.

import { readFileSync } from "node:fs"
import { CARD } from "../card.ts"
import { clock, forecastLine, freeUntil, longDaySummary, pingsFor, seeded, span, tower } from "../tower.ts"

export { span }

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
const LONG = { Mo: "MON", Tu: "TUE", We: "WED", Th: "THU", Fr: "FRI", Sa: "SAT", Su: "SUN" }

export function parseDays(text) {
  const tokens = text.match(/Th|Tu|Sa|Su|Mo|We|Fr|M|T|W|F/g) ?? []
  const names = { M: "Mo", T: "Tu", W: "We", F: "Fr" }
  return tokens.map((t) => names[t] ?? t)
}

export function parseTime(text) {
  const [h, m = "0"] = text.split(":")
  const hour = Number(h)
  const morning = h.startsWith("0")
  return (hour < 8 && !morning ? hour + 12 : hour) * 60 + Number(m)
}

// 6:00-8:00 means 6 to 8 in the evening, not 6 pm to 8 am.
export function parseSpan(startText, endText) {
  const start = parseTime(startText)
  let end = parseTime(endText)
  if (end <= start) end += 12 * 60
  if (end <= start || end > 24 * 60) throw new Error(`Can't read this time: ${startText}-${endText}`)
  return { start, end }
}

export function parseWeek(text, card) {
  const week = Object.fromEntries(DAYS.map((d) => [d, []]))
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    if (!line) continue
    const off = line.match(/^(\S+)\s+off\b/i)
    if (off) {
      for (const d of parseDays(off[1])) {
        week[d].push({ title: "Off", calendar: card.groundCalendar, allDay: true, start: 0, end: 1440 })
      }
      continue
    }
    const item = line.match(/^(\S+)\s+(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s+(.*)$/)
    if (!item) throw new Error(`Can't read this line: ${raw}`)
    for (const d of parseDays(item[1])) {
      week[d].push({ title: item[4], calendar: "School", ...parseSpan(item[2], item[3]) })
    }
  }
  return week
}

export function printWeek(text, card, seed = 1) {
  const week = parseWeek(text, card)
  const rng = seeded(seed)
  const allClasses = DAYS.flatMap((d) => week[d])
  const out = []
  let state = null
  let total = 0

  DAYS.forEach((d, i) => {
    const today = `2026-11-${String(9 + i).padStart(2, "0")}`
    const { plan, state: next } = tower({
      today,
      events: week[d],
      nextSevenDays: allClasses,
      calendars: card.mustSee,
      card,
      state,
      rng,
    })
    state = next

    out.push(`${LONG[d]}  ${forecastLine(plan, card)}`)
    const rows = [
      ...week[d]
        .filter((e) => !e.allDay)
        .map((e) => ({ at: e.start, row: `        ${e.title} until ${clock(e.end)}` })),
      ...pingsFor(plan, card).map((p) => {
        const f = plan.flights[p.flight]
        const note = p.kind === "boarding" ? `   [${span(f.breakMinutes)} open, ${f.card}]` : ""
        return { at: p.at, row: `        "${p.text}"${note}` }
      }),
    ]
    rows.sort((a, b) => a.at - b.at)
    for (const r of rows) out.push(`  ${clock(r.at).padStart(5)}${r.row.slice(7)}`)
    total += plan.flights.reduce((sum, f) => sum + f.length, 0)
    out.push("")
  })

  out.push(`Week total: ${(total / 60).toFixed(1)} flight hours`)
  return out.join("\n")
}

export function printFreeUntil(startText, untilText, card, seed = 1, events = []) {
  const toMinutes = (text) => {
    const [h, m = "0"] = text.split(":")
    return Number(h) * 60 + Number(m)
  }
  const now = toMinutes(startText)
  const until = toMinutes(untilText)
  const { plan } = freeUntil({ today: "2026-11-14", events, card, state: null, rng: seeded(seed), now, until })
  const { legs, air, down } = longDaySummary(plan)
  const out = [`Free until ${clock(until)}: ${legs} legs, ${span(air)} in the air, last Down ${clock(down ?? until)}`]
  plan.flights.forEach((f, i) => {
    out.push(`  ${clock(f.boardAt).padStart(5)} Boarding, leg ${i + 1}, ${f.length} min, ${f.dotMinutes} a dot`)
    out.push(`  ${clock(f.landing).padStart(5)} Down`)
  })
  return out.join("\n")
}

if (process.argv[2] === "free") {
  console.log(printFreeUntil(process.argv[3], process.argv[4], CARD, Number(process.argv[5] ?? 1)))
} else if (process.argv[1]?.endsWith("board.ts")) {
  const file = process.argv[2] ?? new URL("./week.txt", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
  const seed = Number(process.argv[3] ?? 1)
  console.log(printWeek(readFileSync(file, "utf8"), CARD, seed))
}
