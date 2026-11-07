// Everything that touches the iPhone: calendars, pings and the little that's saved.
// The rules live in tower.ts and never see any of this.

import { Notification, Script } from "scripting"
import { CARD } from "./card"
import { clock, forecastLine, freeUntil, pingsFor, say, standDown, tower } from "./tower"

// Written on every event this script makes, so it never touches anything else.
const MARK = "Written by On Air."

const STATE = "state"
const WORDS = "words"
const PRESSED = "pressed"
const LOG = "log"
const LOCK_READY = "lockReady"

// ---- Dates ------------------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, "0")
}

// One calendar day. `at` turns minutes after midnight into a real date, and stays
// right on the two days a year the clocks change.
export function dayOf(date) {
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()
  return {
    today: `${y}-${pad(m + 1)}-${pad(d)}`,
    start: new Date(y, m, d),
    now: date.getHours() * 60 + date.getMinutes(),
    at: (minutes) => new Date(y, m, d, 0, minutes),
  }
}

function minutesInto(day, date) {
  const that = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((that.getTime() - day.start.getTime()) / 86400000)
  return days * 1440 + date.getHours() * 60 + date.getMinutes()
}

// ---- What's saved -----------------------------------------------------------

// The card, with anything you've rewritten on the Words screen laid over it.
export function loadCard() {
  const words = Storage.get(WORDS) ?? {}
  return {
    ...CARD,
    button: words.button || CARD.button,
    preCheck: words.preCheck ?? CARD.preCheck,
    lines: { ...CARD.lines, ...words.lines },
  }
}

export function loadWords() {
  const card = loadCard()
  return { button: card.button, preCheck: card.preCheck, lines: card.lines }
}

export function saveWords(words) {
  Storage.set(WORDS, words)
}

export function lockIsReady() {
  return Storage.get(LOCK_READY) === true
}

export function setLockReady(ready) {
  Storage.set(LOCK_READY, ready)
}

export function loadPressed() {
  return Storage.get(PRESSED)
}

export function loadLog() {
  return Storage.get(LOG) ?? []
}

// ---- Reading the calendars --------------------------------------------------

function readEvent(event, day) {
  return {
    title: event.title,
    calendar: event.calendar?.title ?? "",
    allDay: event.isAllDay,
    start: minutesInto(day, event.startDate),
    end: minutesInto(day, event.endDate),
    free: event.availability === "free",
    declined: event.attendees?.some((a) => a.isCurrentUser && a.status === "declined") ?? false,
  }
}

// A read that fails comes back empty, which the rules treat as "can't see".
async function readCalendars(day) {
  try {
    const calendars = await Calendar.forEvents()
    const today = await CalendarEvent.getAll(day.start, day.at(1440))
    const week = await CalendarEvent.getAll(day.start, day.at(8 * 1440))
    return {
      events: today.map((e) => readEvent(e, day)),
      nextSevenDays: week.map((e) => readEvent(e, day)),
      calendars: calendars.map((c) => c.title),
    }
  } catch {
    return { events: [], nextSevenDays: [], calendars: [] }
  }
}

// ---- Laying the day onto the phone ------------------------------------------

function appLink() {
  return Script.createRunSingleURLScheme(Script.name).replace(/ /g, "%20")
}

// Clears what's waiting and sets it again, so this is safe to run every time.
async function layPings(plan, card, date, day) {
  await Notification.removeAllPendingsOfCurrentScript()
  let refused = 0

  const set = async (seconds, body, tapAction) => {
    const scheduled = await Notification.schedule({
      title: card.name,
      body,
      interruptionLevel: "timeSensitive",
      trigger: new TimeIntervalNotificationTrigger({ timeInterval: seconds, repeats: false }),
      tapAction,
    })
    if (scheduled === false) refused += 1
  }

  for (const ping of pingsFor(plan, card)) {
    const seconds = (day.at(ping.at).getTime() - date.getTime()) / 1000
    if (seconds < 1) continue
    await set(seconds, ping.text, ping.kind === "boarding" ? { type: "openURL", url: appLink() } : "none")
  }

  // If a later morning never lays its day, this is what says so. Every run clears these
  // and sets them further out, so on a normal day you never see one.
  for (let ahead = 1; ahead <= card.morningChecks; ahead++) {
    const morning = day.at(ahead * 1440 + card.morningCheck)
    if (card.seasonEnds && dayOf(morning).today > card.seasonEnds) break
    const seconds = (morning.getTime() - date.getTime()) / 1000
    await set(seconds, say(card.lines.morning, {}, "Tap"), { type: "openURL", url: appLink() })
  }

  return refused
}

// Yours, in iCloud or only on the phone. Never a Google calendar.
function isPrivateToPhone(calendar) {
  const source = calendar.source
  const inICloud = source?.type === "calDAV" && String(source?.title).toLowerCase() === "icloud"
  return inICloud || source?.type === "local"
}

// One block per flight, from boarding to Down. Blocks that already match are left alone
// and ones in the past are never touched.
async function layCalendar(plan, card, date, day) {
  const calendars = await Calendar.forEvents()
  const onAir = calendars.find(
    (c) => c.title === card.onAirCalendar && isPrivateToPhone(c) && c.allowsContentModifications,
  )
  if (!onAir) return false

  const key = (start, end) => `${start.getTime()}/${end.getTime()}`
  const wanted = new Map()
  for (const flight of plan.flights) {
    const start = day.at(flight.boardAt)
    const end = day.at(flight.landing)
    wanted.set(key(start, end), { flight, start, end })
  }

  const laid = await CalendarEvent.getAll(day.start, day.at(1440), [onAir])
  for (const event of laid.filter((e) => e.notes === MARK)) {
    const found = key(event.startDate, event.endDate)
    if (wanted.has(found)) wanted.delete(found)
    else if (event.endDate.getTime() > date.getTime()) await event.remove()
  }

  for (const { flight, start, end } of wanted.values()) {
    if (end.getTime() <= date.getTime()) continue
    const event = new CalendarEvent()
    event.title = say(card.lines.calendar, { board: clock(flight.boardAt) }, "{board}")
    event.calendar = onAir
    event.startDate = start
    event.endDate = end
    event.notes = MARK
    event.url = appLink()
    event.addAlarm(EventAlarm.fromRelativeOffset(0))
    await event.save()
  }
  return true
}

async function layOntoPhone(plan, card, date, day) {
  const problems = []
  try {
    const refused = await layPings(plan, card, date, day)
    if (refused) problems.push(`${refused} pings were refused`)
  } catch (error) {
    problems.push(`Pings failed: ${String(error)}`)
  }
  try {
    const wrote = await layCalendar(plan, card, date, day)
    if (!wrote) problems.push(`No writable ${card.onAirCalendar} calendar in iCloud`)
  } catch (error) {
    problems.push(`Calendar failed: ${String(error)}`)
  }
  return problems
}

// ---- The things that happen -------------------------------------------------

// The one read of the day, safe to repeat. `retry` is true when you opened the app
// yourself, which is the only thing allowed to undo a day that couldn't be read.
export async function refresh({ retry = true, date = new Date() } = {}) {
  const card = loadCard()
  const day = dayOf(date)
  const read = await readCalendars(day)
  const result = tower({
    today: day.today,
    ...read,
    card,
    state: Storage.get(STATE),
    rng: Math.random,
    now: day.now,
    retry,
  })
  if (result.state) Storage.set(STATE, result.state)
  const problems = await layOntoPhone(result.plan, card, date, day)
  return { plan: result.plan, fresh: result.fresh, card, day, problems }
}

// The Shortcut's morning run. No screen, so it says the day out loud as one ping.
export async function morning(date = new Date()) {
  const { plan, fresh, card, problems } = await refresh({ retry: false, date })
  const line = forecastLine(plan, card)
  if (fresh) {
    await Notification.schedule({
      title: card.name,
      body: line,
      interruptionLevel: "active",
      tapAction: { type: "openURL", url: appLink() },
    })
  }
  return problems.length ? `${line} (${problems.join("; ")})` : line
}

// What the Free until screen needs to preview without changing anything.
export async function readForFreeUntil(date = new Date()) {
  const day = dayOf(date)
  const read = await readCalendars(day)
  return { card: loadCard(), day, events: read.events, state: Storage.get(STATE) }
}

export function previewFreeUntil({ card, day, events, state }, until, rng) {
  return freeUntil({ today: day.today, events, card, state, rng, now: day.now, until })
}

export async function declareFreeUntil(preview, date = new Date()) {
  const card = loadCard()
  if (preview.state) Storage.set(STATE, preview.state)
  return layOntoPhone(preview.plan, card, date, dayOf(date))
}

export async function standDownToday(date = new Date()) {
  const card = loadCard()
  const day = dayOf(date)
  const state = Storage.get(STATE)
  if (state?.date !== day.today) return []
  const next = standDown(state, day.now)
  Storage.set(STATE, next)
  return layOntoPhone(next.plan, card, date, day)
}

// The button. It records when you pressed, then hands over to your Shortcut if it exists.
export async function pressBoard(flight, card, date = new Date()) {
  const day = dayOf(date)
  Storage.set(PRESSED, { date: day.today, boardAt: flight.boardAt })
  const log = [
    ...loadLog(),
    {
      date: day.today,
      board: clock(flight.boardAt),
      pressed: clock(day.now),
      late: day.now - flight.boardAt,
      length: flight.length,
    },
  ]
  Storage.set(LOG, log.slice(-200))
  if (lockIsReady()) {
    await Safari.openURL(`shortcuts://run-shortcut?name=${encodeURIComponent(card.lockShortcut)}`)
  }
}
