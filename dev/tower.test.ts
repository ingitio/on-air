// Run with: node --test
//
// Named days first, so a failure reads like a bad day. Then thousands of random
// days checked against the promises the system makes.

import assert from "node:assert/strict"
import { test } from "node:test"
import { CARD as REAL_CARD } from "../card.ts"
import { parseDays, parseSpan, parseTime, parseWeek, printWeek, span } from "./board.ts"
import {
  canSeeCalendar,
  clock,
  dealCard,
  findGaps,
  findWalls,
  flightLength,
  forecastLine,
  freeUntil,
  longDaySummary,
  modeOf,
  newDeck,
  pingsFor,
  planDay,
  roundUpToHalfHour,
  say,
  scrub,
  standDown,
  tower,
} from "../tower.ts"

// The tests name a calendar so they can prove a missing one stops the day.
const CARD = { ...REAL_CARD, mustSee: ["School"] }

function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const at = (h, m = 0) => h * 60 + m
const cls = (startH, startM, endH, endM, extra = {}) => ({
  title: "Class",
  calendar: "School",
  start: at(startH, startM),
  end: at(endH, endM),
  ...extra,
})
const span_ = (start, end, extra = {}) => ({ title: "Thing", calendar: "School", start, end, ...extra })
const plan = (events, seed = 1, extra = {}) =>
  planDay({ events, card: CARD, deck: null, rng: seeded(seed), ...extra })
const seeing = ["School", "On Air", "Ground"]

// ---- Your numbers -----------------------------------------------------------

test("at the cap the deck gives 40, 53, 60 and 80 minutes", () => {
  const lengths = CARD.deck.map((c) => flightLength(120, c.minutes, CARD))
  assert.deepEqual([...new Set(lengths)].sort((a, b) => a - b), [40, 53, 60, 80])
})

test("the longest card equals your longest flight", () => {
  assert.equal(Math.max(...CARD.deck.map((c) => flightLength(600, c.minutes, CARD))), 80)
})

test("the seven cards add up to zero and four of them land early", () => {
  assert.equal(CARD.deck.reduce((sum, c) => sum + c.minutes, 0), 0)
  assert.equal(CARD.deck.filter((c) => c.minutes < 0).length, 4)
})

test("even the biggest card leaves part of a gap free", () => {
  for (let usable = CARD.minUsable; usable <= 400; usable++) {
    for (const c of CARD.deck) {
      assert.ok(flightLength(usable, c.minutes, CARD) <= Math.ceil(0.8 * usable))
    }
  }
})

test("short cards round up to the shortest flight worth picking a plane for", () => {
  assert.equal(flightLength(45, -30, CARD), CARD.minFlight)
})

test("a flight is never longer than the time there is, whatever the card says", () => {
  const wild = { ...CARD, share: 1, cap: 120, deck: [{ name: "Long", minutes: 30 }] }
  for (let usable = 45; usable < 200; usable++) {
    assert.ok(flightLength(usable, 30, wild) <= usable)
  }
  const day = planDay({ events: [cls(9, 0, 10, 0), cls(11, 55, 12, 45)], card: wild, deck: null, rng: seeded(1) })
  assert.ok(day.flights.every((f) => f.landing <= at(11, 40) || f.boardAt >= at(12, 45)))
})

// ---- Named days -------------------------------------------------------------

test("a normal class day rides each class out", () => {
  const day = plan([cls(9, 5, 9, 55), cls(11, 15, 12, 5), cls(14, 30, 15, 20)])
  assert.equal(day.status, "open")
  assert.equal(day.flights[0].boardAt, at(10, 0))
  assert.equal(day.flights[0].takeoff, at(10, 10))
  assert.equal(day.flights[1].boardAt, at(12, 10))
})

test("back-to-back classes leave no flight between them", () => {
  const day = plan([cls(9, 5, 9, 55), cls(10, 10, 11, 0)])
  assert.ok(day.flights.every((f) => f.boardAt >= at(11, 0)))
})

test("overlapping and touching events melt into one wall", () => {
  const walls = findWalls([cls(9, 0, 10, 0), cls(9, 30, 11, 0), cls(11, 0, 11, 30)], CARD)
  assert.deepEqual(walls, [[at(9), at(11, 30)]])
})

test("all-day events are never walls", () => {
  const event = { title: "Spirit week", calendar: "School", allDay: true, start: 0, end: 1440 }
  assert.deepEqual(findWalls([event], CARD), [])
})

test("an all-day event on Ground shuts the airport", () => {
  const event = { title: "Thanksgiving", calendar: "Ground", allDay: true, start: 0, end: 1440 }
  const day = plan([event, cls(9, 5, 9, 55)])
  assert.equal(day.status, "closed")
  assert.equal(day.flights.length, 0)
})

test("anything on Ground that has a time is a wall", () => {
  assert.equal(findWalls([cls(12, 0, 12, 45, { calendar: "Ground" })], CARD).length, 1)
})

test("a due-at-11:59 marker doesn't block anything", () => {
  assert.deepEqual(findWalls([cls(23, 59, 23, 59)], CARD), [])
})

test("declined invites and free events aren't walls, tentative ones are", () => {
  assert.deepEqual(findWalls([cls(9, 0, 10, 0, { declined: true })], CARD), [])
  assert.deepEqual(findWalls([cls(9, 0, 10, 0, { free: true })], CARD), [])
  assert.equal(findWalls([cls(9, 0, 10, 0, { tentative: true })], CARD).length, 1)
})

test("an event that ends before it starts stays a wall to the end of the day", () => {
  assert.deepEqual(findWalls([span_(660, 600)], CARD), [[660, 1440]])
})

test("the Tower ignores its own On Air calendar", () => {
  assert.deepEqual(findWalls([cls(9, 0, 17, 0, { calendar: "On Air" })], CARD), [])
})

test("an event crossing midnight still blocks the morning", () => {
  const day = plan([span_(at(-2), at(10))])
  assert.ok(day.flights.every((f) => f.boardAt >= at(10)))
})

test("a class right after closing still gets its walk", () => {
  const day = plan([cls(8, 30, 20, 0), cls(21, 0, 22, 0)], 8)
  assert.ok(day.flights.every((f) => f.landing + CARD.walk <= at(21)))
})

test("a class that ended a minute before the morning run still gets its walk", () => {
  const day = plan([cls(9, 0, 10, 0), cls(13, 0, 14, 0)], 1, { now: at(10, 1) })
  assert.equal(day.flights[0].takeoff, at(10, 15))
})

test("an empty Saturday chains flights with real rest between them", () => {
  const day = plan([], 3)
  assert.ok(day.flights.length >= 2)
  assert.ok(day.flights[0].boardAt >= CARD.open + CARD.firstBoardingMin)
  assert.ok(day.flights[0].boardAt <= CARD.open + CARD.firstBoardingMax)
  for (let i = 1; i < day.flights.length; i++) {
    const previous = day.flights[i - 1]
    const rest = day.flights[i].boardAt - previous.landing
    assert.ok(rest >= Math.max(CARD.restMin, Math.round(CARD.restShare * previous.length)))
  }
})

test("a real 4-hour break keeps flying and a 3-hour one doesn't", () => {
  let chained = 0
  for (let seed = 1; seed <= 200; seed++) {
    const four = plan([cls(9, 0, 9, 55), cls(13, 55, 15, 0)], seed)
    if (four.flights.filter((f) => f.boardAt < at(13, 55)).length >= 2) chained++
    const three = plan([cls(9, 0, 9, 55), cls(12, 55, 15, 0)], seed)
    assert.equal(three.flights.filter((f) => f.boardAt < at(12, 55)).length, 1)
  }
  // A long first flight plus the longest rest can leave no room for a second.
  assert.ok(chained >= 170, `only ${chained} of 200 chained`)
})

test("with no class to ride, the first boarding waits, even before a noon game", () => {
  for (let seed = 1; seed < 200; seed++) {
    const first = plan([cls(12, 0, 14, 0)], seed).flights[0]
    assert.ok(first.boardAt >= CARD.open + CARD.firstBoardingMin, `seed ${seed}`)
    assert.ok(first.landing + CARD.walk <= at(12), `seed ${seed}`)
  }
})

test("a tight morning pulls the first boarding earlier so the flight still fits", () => {
  const first = plan([cls(9, 45, 11, 0)], 2).flights[0]
  assert.equal(first.boardAt, at(8, 40))
  assert.ok(first.landing + CARD.walk <= at(9, 45))
})

test("a late morning run never boards in the past", () => {
  const day = plan([cls(14, 0, 15, 0)], 2, { now: at(11, 7) })
  assert.ok(day.flights.every((f) => f.boardAt > at(11, 7)))
})

test("a run after closing just says nothing's boarding", () => {
  const day = plan([], 2, { now: at(22) })
  assert.equal(day.status, "clear")
  assert.equal(forecastLine(day, CARD), CARD.lines.clear)
})

test("no day boards more than three times", () => {
  for (let seed = 1; seed < 400; seed++) {
    const day = plan([cls(9, 5, 9, 55), cls(11, 15, 12, 5), cls(14, 30, 15, 20), cls(17, 0, 18, 0)], seed)
    assert.ok(day.flights.length <= CARD.maxFlights)
  }
})

test("a flight the budget can't hold ends the day, and its card stays in the deck", () => {
  for (let seed = 1; seed < 400; seed++) {
    const day = plan([], seed)
    const total = day.flights.reduce((sum, f) => sum + f.length, 0)
    assert.ok(total <= CARD.budget)
    for (const f of day.flights) {
      assert.equal(f.length, flightLength(f.usable, f.cardMinutes, CARD), "no flight is ever trimmed")
    }
    assert.equal(day.deck.next, day.flights.length, "only flights that fly spend a card")
  }
})

test("a free lunch: a gap too small to fly stays yours", () => {
  const day = plan([cls(9, 5, 11, 0), cls(11, 40, 13, 0)])
  assert.ok(day.flights.every((f) => f.boardAt < at(11) || f.boardAt > at(11, 40)))
})

test("every flight in a long break carries that break's real size", () => {
  const day = plan([cls(13, 5, 14, 0)], 2)
  const morning = day.flights.filter((f) => f.boardAt < at(13))
  assert.ok(morning.length >= 2)
  assert.deepEqual([...new Set(morning.map((f) => f.breakMinutes))], [at(13, 5) - CARD.open])
  assert.deepEqual([...new Set(morning.map((f) => f.mode))], ["4 hr"])
})

// ---- The one-way promise ----------------------------------------------------

const monday = [cls(9, 5, 9, 55), cls(11, 15, 12, 5), cls(14, 30, 15, 20)]
const threeFlightSeed = (() => {
  for (let seed = 1; seed < 500; seed++) if (plan(monday, seed).flights.length === 3) return seed
  throw new Error("no three-flight seed")
})()
const morningOf = () => plan(monday, threeFlightSeed)

test("a class added at 11 scrubs what it hits and nothing else", () => {
  const morning = morningOf()
  const hit = morning.flights[1]
  const added = span_(hit.boardAt + 10, hit.boardAt + 40)
  const later = scrub(morning, [...monday, added], CARD, at(11))
  assert.equal(later.flights.length, morning.flights.length - 1)
  assert.ok(!later.flights.some((f) => f.boardAt === hit.boardAt))
})

test("after a scrub, the Down line before it names the next real boarding", () => {
  const morning = morningOf()
  const hit = morning.flights[1]
  const later = scrub(morning, [...monday, span_(hit.boardAt + 10, hit.boardAt + 40)], CARD, at(9))
  const firstDown = pingsFor(later, CARD).find((p) => p.kind === "landing")
  assert.equal(firstDown.text, `Down. Nothing boards before ${clock(morning.flights[2].boardAt)}.`)
})

test("a class canceled at 11 adds no flight", () => {
  const morning = morningOf()
  const later = scrub(morning, monday.slice(0, 2), CARD, at(11))
  assert.deepEqual(later.flights, morning.flights)
})

test("an all-day Ground event added at 9:30 shuts what's left of the day", () => {
  const morning = morningOf()
  const off = { title: "Sick", calendar: "Ground", allDay: true, start: 0, end: 1440 }
  const later = scrub(morning, [...monday, off], CARD, at(9, 30))
  assert.equal(later.flights.length, 0)
  assert.deepEqual(pingsFor(later, CARD), [])
})

test("the one allowed exception: a flight already called keeps its Down line", () => {
  const morning = morningOf()
  const first = morning.flights[0]
  const added = span_(first.landing - 5, first.landing + 30)
  const later = scrub(morning, [...monday, added], CARD, first.boardAt + 1)
  assert.ok(later.flights.some((f) => f.boardAt === first.boardAt))
})

test("two runs in one morning change nothing", () => {
  const rng = seeded(5)
  const base = { today: "2026-11-09", events: monday, nextSevenDays: monday, calendars: seeing, card: CARD, rng, now: at(7, 30) }
  const first = tower({ ...base, state: null })
  const second = tower({ ...base, state: first.state })
  assert.equal(first.plan.status, "open")
  assert.equal(first.fresh, true)
  assert.equal(second.fresh, false)
  assert.deepEqual(second.plan.flights, first.plan.flights)
  assert.deepEqual(second.state.deck, first.state.deck)
})

test("a same-day run without the time is refused, so a called flight can't vanish", () => {
  const rng = seeded(5)
  const base = { today: "2026-11-09", events: monday, nextSevenDays: monday, calendars: seeing, card: CARD, rng }
  const first = tower({ ...base, state: null, now: at(7, 30) })
  assert.throws(() => tower({ ...base, state: first.state }))
})

test("a run the next day lays a fresh plan and keeps the deck moving", () => {
  const rng = seeded(5)
  const base = { events: monday, nextSevenDays: monday, calendars: seeing, card: CARD, rng, now: at(7, 30) }
  const first = tower({ ...base, today: "2026-11-09", state: null })
  const next = tower({ ...base, today: "2026-11-10", state: first.state })
  assert.equal(next.fresh, true)
  assert.notDeepEqual(next.state.deck, first.state.deck)
})

test("a reread can only lower the count and pull the close in", () => {
  for (let seed = 1; seed < 300; seed++) {
    const rng = seeded(seed)
    let day = plan(monday, seed)
    let events = [...monday]
    for (let step = 0; step < 6; step++) {
      const start = at(8) + Math.floor(rng() * 720)
      const change = rng() < 0.5
      events = change
        ? [...events, span_(start, start + 30 + Math.floor(rng() * 90))]
        : events.filter((_, i) => i !== Math.floor(rng() * events.length))
      const later = scrub(day, events, CARD, at(8))
      assert.ok(later.flights.length <= day.flights.length)
      if (later.closeAfter !== null && day.closeAfter !== null) {
        assert.ok(later.closeAfter <= day.closeAfter)
      }
      day = later
    }
  }
})

// ---- Fuses ------------------------------------------------------------------

const run = (extra) =>
  tower({ today: "2026-11-09", events: monday, nextSevenDays: monday, calendars: seeing, card: CARD, state: null, rng: seeded(1), now: at(8), ...extra })

test("a read with nothing at all in it means 'I don't know', so nothing boards", () => {
  const blank = run({ events: [], nextSevenDays: [] })
  assert.equal(blank.plan.status, "unknown")
  assert.equal(blank.plan.flights.length, 0)
  assert.deepEqual(pingsFor(blank.plan, CARD), [])
})

test("a dark morning stays dark, so 'nothing boards' stays true", () => {
  const dark = run({ nextSevenDays: [] })
  const later = run({ state: dark.state, now: at(10) })
  assert.equal(later.plan.status, "unknown")
  assert.equal(later.plan.flights.length, 0)
})

test("your own tap is the one thing that can bring a dark day back", () => {
  const dark = run({ nextSevenDays: [] })
  const tapped = run({ state: dark.state, now: at(10), retry: true })
  assert.equal(tapped.plan.status, "open")
  assert.ok(tapped.plan.flights.every((f) => f.boardAt > at(10)))
})

test("one bad read later in the day isn't news: the count goes 3, 3, 3, never 3, 0, 3", () => {
  const morning = run({})
  const blind = run({ state: morning.state, now: at(9), nextSevenDays: [] })
  assert.deepEqual(blind.plan.flights, morning.plan.flights)
  const back = run({ state: blind.state, now: at(9, 30) })
  assert.deepEqual(back.plan.flights, morning.plan.flights)
})

test("a tap on a normal day changes nothing", () => {
  const morning = run({})
  const tapped = run({ state: morning.state, now: at(9), retry: true })
  assert.equal(tapped.fresh, false)
  assert.deepEqual(tapped.plan.flights, morning.plan.flights)
})

test("the Tower trusts a read only if your named calendars are still listed", () => {
  const closingBlock = cls(21, 0, 23, 0, { calendar: "Ground" })
  assert.equal(canSeeCalendar([closingBlock], CARD, seeing), true)
  assert.equal(canSeeCalendar([closingBlock], CARD, ["On Air", "Ground"]), false, "school account gone")
  assert.equal(canSeeCalendar([], CARD, []), false, "locked phone")
})

test("its own On Air lines don't prove the phone can read your calendars", () => {
  assert.equal(canSeeCalendar([cls(9, 0, 10, 0, { calendar: "On Air" })], CARD, seeing), false)
})

test("finals week flies: no classes, but your closing block proves the read worked", () => {
  const closingBlock = cls(21, 0, 23, 0, { calendar: "Ground" })
  const exam = cls(10, 30, 12, 30, { calendar: "Exams" })
  const day = run({ today: "2026-12-18", events: [closingBlock, exam], nextSevenDays: [closingBlock, exam] })
  assert.equal(day.plan.status, "open")
  assert.ok(day.plan.flights.every((f) => f.landing + CARD.walk <= exam.start || f.boardAt >= exam.end))
})

test("a study day with nothing on it during finals still flies", () => {
  const closingBlock = cls(21, 0, 23, 0, { calendar: "Ground" })
  const day = run({ today: "2026-12-19", events: [closingBlock], nextSevenDays: [closingBlock] })
  assert.equal(day.plan.status, "open")
  assert.ok(day.plan.flights.length >= 2)
})

test("when the season ends the Tower calls nothing", () => {
  const off = run({ today: "2026-12-24" })
  assert.equal(off.plan.status, "off")
  assert.deepEqual(pingsFor(off.plan, CARD), [])
})

// ---- Free until -------------------------------------------------------------

const free = (hours, extra = {}, seed = 1) =>
  freeUntil({ today: "2026-11-14", events: [], card: CARD, state: null, rng: seeded(seed), now: at(10), until: at(10) + hours * 60, ...extra })

test("6 hours is usually four legs, and no leg passes 80", () => {
  let fourLegs = 0
  for (let seed = 1; seed <= 1000; seed++) {
    const { plan } = free(6, {}, seed)
    if (plan.flights.length === 4) fourLegs++
    assert.ok(plan.flights.length === 3 || plan.flights.length === 4, `seed ${seed}`)
    assert.ok(plan.flights.every((f) => f.length <= 80))
    assert.ok(plan.flights.at(-1).landing <= at(16))
  }
  assert.ok(fourLegs >= 850, `only ${fourLegs} of 1000`)
})

test("every window from 1 to 8 hours stays inside itself", () => {
  for (const hours of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (let seed = 1; seed <= 300; seed++) {
      const { plan } = free(hours, {}, seed)
      assert.ok(plan.flights.length >= 1, `${hours} hours, seed ${seed}`)
      assert.ok(plan.flights.at(-1).landing <= at(10) + hours * 60)
      for (let i = 1; i < plan.flights.length; i++) {
        assert.ok(plan.flights[i].boardAt - plan.flights[i - 1].landing >= CARD.longDay.ground)
      }
    }
  }
})

test("a class in the middle of a long day is still a wall, with its walk", () => {
  const events = [cls(13, 0, 14, 0)]
  for (let seed = 1; seed <= 300; seed++) {
    const { plan } = free(6, { events }, seed)
    for (const f of plan.flights) {
      assert.ok(f.landing + CARD.walk <= at(13) || f.boardAt >= at(14), `seed ${seed}`)
    }
  }
})

test("a long day replaces what was left of today", () => {
  const morning = run({})
  const now = morning.plan.flights[0].landing + 1
  const { plan, state } = freeUntil({ today: "2026-11-09", events: monday, card: CARD, state: morning.state, rng: seeded(2), now, until: at(20) })
  assert.ok(plan.flights.every((f) => f.boardAt > now))
  assert.deepEqual(state.plan.flights, plan.flights)
})

test("a flight in the air keeps flying, and the long day starts after it lands", () => {
  const morning = run({})
  const flying = morning.plan.flights[0]
  const now = flying.boardAt + 10
  const { plan } = freeUntil({ today: "2026-11-09", events: monday, card: CARD, state: morning.state, rng: seeded(2), now, until: at(20) })
  assert.deepEqual(plan.flights[0], flying)
  assert.ok(plan.flights.slice(1).every((f) => f.boardAt >= flying.landing + CARD.longDay.ground))
  assert.equal(plan.declaredUntil, at(20))
})

test("once declared, a long day can only shrink", () => {
  const first = free(6)
  const longer = freeUntil({ today: "2026-11-14", events: [], card: CARD, state: first.state, rng: seeded(3), now: at(11), until: at(20) })
  assert.deepEqual(longer.plan.flights, first.plan.flights, "asking for more changes nothing")
  const shorter = freeUntil({ today: "2026-11-14", events: [], card: CARD, state: first.state, rng: seeded(3), now: at(11), until: at(13) })
  assert.ok(shorter.plan.flights.length < first.plan.flights.length)
  assert.ok(shorter.plan.flights.every((f) => f.landing <= at(13) || f.boardAt <= at(11)))
  assert.equal(shorter.plan.declaredUntil, at(13))
})

test("a run later that day keeps the long day and can only lighten it", () => {
  const first = free(6)
  const base = { today: "2026-11-14", nextSevenDays: monday, calendars: seeing, card: CARD, rng: seeded(1), now: at(11) }
  const same = tower({ ...base, events: [], state: first.state })
  assert.deepEqual(same.plan.flights, first.plan.flights)
  assert.equal(same.plan.declaredUntil, at(16))
})

test("the deck carries through a long day like any other", () => {
  const first = free(6)
  assert.equal(first.state.deck.next, first.plan.flights.length)
  const seen = first.plan.flights.map((f) => f.card)
  assert.equal(new Set(seen).size, seen.length)
})

test("a window too short to fly says so instead of faking it", () => {
  const { plan } = freeUntil({ today: "2026-11-14", events: [], card: CARD, state: null, rng: seeded(1), now: at(10), until: at(10, 30) })
  assert.equal(plan.status, "clear")
  assert.equal(longDaySummary(plan).legs, 0)
})

test("a closed day says no, and nothing is saved", () => {
  const off = { title: "Off", calendar: "Ground", allDay: true, start: 0, end: 1440 }
  const { plan, state } = free(6, { events: [off] })
  assert.equal(plan.status, "closed")
  assert.equal(state, null)
})

test("the preview gives the honest number before you press", () => {
  const { plan } = free(6)
  const { legs, air, down } = longDaySummary(plan)
  assert.equal(legs, plan.flights.length)
  assert.equal(air, plan.flights.reduce((sum, f) => sum + f.length, 0))
  assert.equal(down, plan.flights.at(-1).landing)
})

test("stand down clears everything that hasn't landed, and stays down", () => {
  const morning = run({})
  const state = standDown(morning.state, at(9))
  assert.equal(state.plan.status, "closed")
  assert.deepEqual(state.plan.flights, [])
  const later = run({ state, now: at(10) })
  assert.equal(later.plan.status, "closed")
})

// ---- The deck ---------------------------------------------------------------

test("each round deals all seven cards before any repeats", () => {
  const rng = seeded(9)
  let deck = null
  const seen = []
  for (let i = 0; i < 70; i++) {
    const { dealt, deck: next } = dealCard(deck, CARD, rng)
    seen.push(dealt.name)
    deck = next
  }
  for (let i = 0; i < 70; i += 7) assert.equal(new Set(seen.slice(i, i + 7)).size, 7)
})

test("three long cards never come in a row, even across a reshuffle", () => {
  for (let seed = 1; seed < 200; seed++) {
    const rng = seeded(seed)
    let deck = null
    let run = 0
    for (let i = 0; i < 700; i++) {
      const { dealt, deck: next } = dealCard(deck, CARD, rng)
      run = dealt.minutes === 30 ? run + 1 : 0
      assert.ok(run < 3)
      deck = next
    }
  }
})

test("a deck survives being saved and read back as plain data", () => {
  const rng = seeded(4)
  let deck = newDeck(CARD, rng)
  for (let i = 0; i < 30; i++) {
    deck = JSON.parse(JSON.stringify(deck))
    deck = dealCard(deck, CARD, rng).deck
  }
  assert.ok(deck.next >= 1)
})

test("editing your cards mid-round reshuffles instead of crashing", () => {
  const saved = { order: [2, 4, 3, 0, 5, 1, 6], next: 6, recent: [30, -10] }
  const shorter = { ...CARD, deck: CARD.deck.slice(0, 6) }
  const { dealt } = dealCard(saved, shorter, seeded(1))
  assert.ok(dealt.name)
})

test("an empty rest list can't hang the planner", () => {
  const day = planDay({ events: [], card: { ...CARD, restExtras: [] }, deck: null, rng: seeded(1) })
  assert.ok(day.flights.length >= 1)
})

// ---- Pings ------------------------------------------------------------------

test("every flight has a boarding line, a descent line and a down line, in order", () => {
  const day = plan(monday)
  const pings = pingsFor(day, CARD)
  assert.equal(pings.length, day.flights.length * 3)
  assert.deepEqual(pings.map((p) => p.kind).slice(0, 3), ["boarding", "descent", "landing"])
  for (let i = 1; i < pings.length; i++) assert.ok(pings[i].at >= pings[i - 1].at)
})

test("boarding states the general amount, this flight's size and the size of a dot", () => {
  const day = morningOf()
  const first = day.flights[0]
  assert.match(pingsFor(day, CARD)[0].text, new RegExp(`About ${first.general} today, this one's ${first.length}\\. ${first.dotMinutes} minutes a dot`))
})

test("descent is the same on every flight, however long", () => {
  for (const f of plan(monday).flights) assert.equal(f.landing - f.descentAt, CARD.descent)
})

test("a dot is the working time over six, so any split of six dots fills the flight", () => {
  const dotFor = (length) => Math.round((length - CARD.descent) / CARD.dots)
  assert.deepEqual([25, 40, 53, 60, 80].map(dotFor), [3, 6, 8, 9, 12])
})

test("nothing the phone says is about studying", () => {
  const text = JSON.stringify(CARD.lines).toLowerCase()
  for (const word of ["book", "study", "recall", "exam", "class"]) assert.ok(!text.includes(word), word)
})

test("no line ever says whether you flew", () => {
  const text = JSON.stringify(CARD.lines).toLowerCase()
  for (const word of ["missed", "grounded", "skipped", "failed", "late"]) {
    assert.ok(!text.includes(word), word)
  }
})

test("the last line of the day closes the airport, the rest name the next time", () => {
  const pings = pingsFor(morningOf(), CARD)
  const downs = pings.filter((p) => p.kind === "landing")
  assert.match(downs[0].text, /Nothing boards before \d/)
  assert.equal(downs.at(-1).text, CARD.lines.landingLast)
})

test("a blank line on your card sends plain data only", () => {
  const blank = { ...CARD, lines: { ...CARD.lines, boarding: "  " } }
  const first = pingsFor(plan(monday), blank)[0]
  assert.match(first.text, /^\d+ \/ \d+ \/ \d+:\d\d$/)
})

test("say fills in names and leaves no braces behind", () => {
  assert.equal(say("Down {land}{nope}.", { land: "3:05" }), "Down 3:05.")
})

// ---- Random days: the promises hold everywhere -------------------------------

function randomDay(rng) {
  const events = []
  const count = Math.floor(rng() * 7)
  for (let i = 0; i < count; i++) {
    const start = at(7) + Math.floor(rng() * 900) // runs well past closing time
    const end = start + 15 + Math.floor(rng() * 150)
    const kind = rng()
    if (kind < 0.08) events.push({ title: "All day", calendar: "School", allDay: true, start: 0, end: 1440 })
    else if (kind < 0.14) events.push(span_(start, end, { free: true }))
    else if (kind < 0.2) events.push(span_(start, end, { declined: true }))
    else if (kind < 0.26) events.push(span_(start, start))
    else if (kind < 0.3) events.push(span_(start, start - 30))
    else if (kind < 0.4) events.push(span_(start, end, { calendar: "Ground" }))
    else events.push(span_(start, end))
  }
  return events
}

test("40,000 random days keep every promise", () => {
  for (let seed = 1; seed <= 40000; seed++) {
    const rng = seeded(seed)
    const events = randomDay(rng)
    const now = rng() < 0.2 ? at(7) + Math.floor(rng() * 840) : null
    const day = planDay({ events, card: CARD, deck: null, rng, now })
    const walls = findWalls(events, CARD)
    const inWall = (t) => walls.some(([a, b]) => t >= a && t < b)
    const label = `seed ${seed}`

    assert.ok(day.flights.reduce((sum, f) => sum + f.length, 0) <= CARD.budget, label)
    assert.ok(day.flights.length <= CARD.maxFlights, label)

    let previousLanding = -Infinity
    for (const f of day.flights) {
      assert.ok(f.length >= CARD.minFlight && f.length <= 80, `${label} length ${f.length}`)
      assert.ok(!inWall(f.boardAt), `${label} boarding inside a class`)
      assert.ok(!inWall(f.landing), `${label} landing inside a class`)
      assert.ok(f.boardAt <= f.takeoff && f.takeoff < f.landing, `${label} order`)
      assert.ok(f.boardAt >= previousLanding, `${label} flights overlap`)
      assert.ok(f.boardAt >= CARD.open && f.landing <= CARD.latestClose, `${label} outside hours`)
      if (now !== null) assert.ok(f.boardAt > now, `${label} past boarding`)

      // Never through a wall, and always leaves the walk to the next one.
      assert.ok(
        !walls.some(([a, b]) => a < f.landing + CARD.walk && b > f.takeoff),
        `${label} crosses a wall or leaves no walk`,
      )
      assert.ok(f.descentAt > f.takeoff && f.descentAt < f.landing, `${label} descent`)
      assert.ok(f.dotMinutes >= 1, `${label} dot`)
      previousLanding = f.landing
    }

    if (day.status === "open") {
      assert.ok(day.closeAfter >= day.flights.at(-1).landing, label)
      assert.ok(day.closeAfter - day.flights.at(-1).landing < 30, label)
      assert.ok(!forecastLine(day, CARD).includes("{"), label)
    }
  }
})

// ---- Small tools ------------------------------------------------------------

test("clock and rounding read the way you'd say them", () => {
  assert.equal(clock(at(14, 5)), "2:05")
  assert.equal(clock(at(0, 30)), "12:30")
  assert.equal(clock(at(12)), "12:00")
  assert.equal(roundUpToHalfHour(at(17, 1)), at(17, 30))
  assert.equal(roundUpToHalfHour(at(17, 30)), at(17, 30))
})

test("gap modes use your four words for the real length of the break", () => {
  assert.equal(modeOf(25), "20-30 min")
  assert.equal(modeOf(80), "1 hr")
  assert.equal(modeOf(180), "3 hr")
  assert.equal(modeOf(240), "4 hr")
})

test("findGaps gives the stretches between walls", () => {
  const gaps = findGaps([[at(9), at(10)], [at(12), at(13)]], at(8, 30), at(21))
  assert.deepEqual(gaps, [
    { start: at(8, 30), end: at(9) },
    { start: at(10), end: at(12) },
    { start: at(13), end: at(21) },
  ])
})

test("week files read the way you'd write them", () => {
  assert.deepEqual(parseDays("MWF"), ["Mo", "We", "Fr"])
  assert.deepEqual(parseDays("TTh"), ["Tu", "Th"])
  assert.deepEqual(parseDays("SaSu"), ["Sa", "Su"])
  assert.equal(parseTime("2:30"), at(14, 30))
  assert.equal(parseTime("14:30"), at(14, 30))
  assert.equal(parseTime("9:05"), at(9, 5))
  assert.equal(parseTime("07:30"), at(7, 30))
  const week = parseWeek("MWF 9:05-9:55 Chem\nSa off\n# a note\n", CARD)
  assert.equal(week.Mo.length, 1)
  assert.equal(week.Sa[0].allDay, true)
  assert.throws(() => parseWeek("sometime chem", CARD))
})

test("evening times read as evening", () => {
  assert.deepEqual(parseSpan("6:00", "8:00"), { start: at(18), end: at(20) })
  assert.deepEqual(parseSpan("6:30", "9:00"), { start: at(18, 30), end: at(21) })
  assert.deepEqual(parseSpan("10:00", "1:00"), { start: at(10), end: at(13) })
  assert.deepEqual(parseSpan("07:30", "09:00"), { start: at(7, 30), end: at(9) })
  assert.throws(() => parseSpan("23:00", "22:00"))
})

test("breaks print in hours and minutes", () => {
  assert.equal(span(80), "1 hr 20 min")
  assert.equal(span(45), "45 min")
  assert.equal(span(120), "2 hr")
})

test("a whole week prints", () => {
  const text = printWeek("MWF 9:05-9:55 Chem\nSa off\n", CARD, 2)
  assert.match(text, /MON {2}Expecting/)
  assert.match(text, /SAT {2}Airport closed today\./)
})

test("20,000 random long days keep every promise", () => {
  for (let seed = 1; seed <= 20000; seed++) {
    const rng = seeded(seed)
    const events = randomDay(rng)
    const now = at(7) + Math.floor(rng() * 600)
    const until = now + 30 + Math.floor(rng() * 540)
    const { plan } = freeUntil({ today: "2026-11-14", events, card: CARD, state: null, rng, now, until })
    if (plan.status === "closed") continue
    const walls = findWalls(events, CARD)
    const label = `seed ${seed}`
    let previous = null
    for (const f of plan.flights) {
      assert.ok(f.boardAt > now, `${label} past boarding`)
      assert.ok(f.landing <= until, `${label} past the window`)
      assert.ok(f.length >= CARD.minFlight && f.length <= 80, `${label} length ${f.length}`)
      assert.ok(
        !walls.some(([a, b]) => a < f.landing + CARD.walk && b > f.takeoff),
        `${label} crosses a wall or leaves no walk`,
      )
      if (previous) assert.ok(f.boardAt - previous.landing >= CARD.longDay.ground, `${label} no ground time`)
      previous = f
    }
    for (const p of pingsFor(plan, CARD)) assert.ok(!p.text.includes("{"), label)
  }
})
