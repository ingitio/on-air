// The Tower: turns one day of calendar events into a forecast and a list of pings.
//
// Plain rules only. No phone code and no wording live here, so the same file runs
// on the PC for testing and on the iPhone for real. It is written as plain
// JavaScript inside a .ts file so Node, Scripting and Scriptable can all read it.
//
// Times are minutes after that day's midnight. 870 means 2:30 pm.
// An event can run past either end of the day: -30 or 1500 are both fine.
//
// The promise this file keeps: the day is laid once, every line is true whether
// you flew or not, and after that the plan can only get lighter.

// ---- Clock ------------------------------------------------------------------

export function clock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60) % 12 || 12
  return `${h}:${String(m % 60).padStart(2, "0")}`
}

export function roundUpToHalfHour(minutes) {
  return Math.ceil(minutes / 30) * 30
}

// 80 reads as "1 hr 20 min".
export function span(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h ? `${h} hr` : "", m ? `${m} min` : ""].filter(Boolean).join(" ")
}

// The same seed always deals the same numbers, so a preview can't reshuffle under you.
export function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- Reading the day --------------------------------------------------------

// A wall is any timed thing you can't fly through. Anything unclear stays a wall,
// because a lost flight costs nothing and a wrong ping costs trust.
function isWall(e, card) {
  if (e.calendar === card.onAirCalendar) return false // never trip over our own lines
  if (e.allDay || e.free || e.declined) return false
  return e.end !== e.start // zero-length markers like "due 11:59" block nothing
}

export function findWalls(events, card) {
  const spans = []
  for (const e of events) {
    if (!isWall(e, card)) continue
    // An end before its start makes no sense, so it blocks the rest of the day.
    spans.push([e.start, e.end < e.start ? 1440 : e.end])
  }
  spans.sort((a, b) => a[0] - b[0])

  const walls = []
  for (const [start, end] of spans) {
    const last = walls[walls.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else walls.push([start, end])
  }
  return walls
}

// An all-day event on your Ground calendar shuts the airport for that day.
export function isClosedDay(events, card) {
  return events.some((e) => e.allDay && e.calendar === card.groundCalendar)
}

// The open stretches between walls, inside the given window.
export function findGaps(walls, from, to) {
  const gaps = []
  let cursor = from
  for (const [start, end] of walls) {
    if (end <= cursor) continue
    if (start >= to) break
    if (start > cursor) gaps.push({ start: cursor, end: start })
    cursor = Math.max(cursor, end)
  }
  if (cursor < to) gaps.push({ start: cursor, end: to })
  return gaps
}

// Names for how long a break really is, in your own four modes.
export function modeOf(breakMinutes) {
  if (breakMinutes < 45) return "20-30 min"
  if (breakMinutes < 120) return "1 hr"
  if (breakMinutes < 210) return "3 hr"
  return "4 hr"
}

// True if the read can be trusted. To the code, a calendar it couldn't read and an
// empty week look the same, so it asks two things an empty week can't fake: can the
// phone still list the calendars you named, and did anything at all come back? Your
// own closing block on Ground is enough, so finals week and a summer with no classes
// still fly. A stale copy of a calendar can't be caught this way.
export function canSeeCalendar(nextSevenDays, card, visibleCalendars) {
  const listed = visibleCalendars ?? nextSevenDays.map((e) => e.calendar)
  const named = (card.mustSee ?? []).every((name) => listed.includes(name))
  return named && nextSevenDays.some((e) => e.calendar !== card.onAirCalendar)
}

// ---- The deck ---------------------------------------------------------------

function shuffle(items, rng) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function hasThreeLongInARow(values, longest) {
  let run = 0
  for (const v of values) {
    run = v === longest ? run + 1 : 0
    if (run >= 3) return true
  }
  return false
}

// A deck is plain data so the phone can save it: which cards are left, and the
// last two dealt so a reshuffle can't make three long flights in a row.
export function newDeck(card, rng, recent = []) {
  const values = card.deck.map((_, i) => i)
  const minutes = card.deck.map((c) => c.minutes)
  const longest = Math.max(...minutes)
  for (let tries = 0; tries < 200; tries++) {
    const order = shuffle(values, rng)
    const run = [...recent, ...order.map((i) => minutes[i])]
    if (!hasThreeLongInARow(run, longest)) return { order, next: 0, recent }
  }
  // Only reachable with a deck that can't avoid it, so don't hang on a bad card.
  return { order: shuffle(values, rng), next: 0, recent }
}

// A saved deck can stop matching the card if you edit your seven cards.
function deckStillFits(deck, card) {
  return (
    deck &&
    deck.next < deck.order.length &&
    deck.order.length === card.deck.length &&
    deck.order.every((i) => i < card.deck.length)
  )
}

export function dealCard(deck, card, rng) {
  const current = deckStillFits(deck, card) ? deck : newDeck(card, rng, deck?.recent ?? [])
  const dealt = card.deck[current.order[current.next]]
  return {
    dealt,
    deck: {
      order: current.order,
      next: current.next + 1,
      recent: [...current.recent, dealt.minutes].slice(-2),
    },
  }
}

// ---- One flight -------------------------------------------------------------

export function generalAmount(usable, card) {
  return Math.min(card.cap, card.share * usable)
}

// The general amount, then the card, shrunk in proportion under 90 minutes.
// Short cards round up, and a flight can never be longer than the time there is.
export function flightLength(usable, cardMinutes, card) {
  const general = generalAmount(usable, card)
  const dealt = Math.round(general + cardMinutes * Math.min(1, general / 90))
  return Math.min(usable, Math.max(card.minFlight, dealt))
}

function layFlight({ boardAt, takeoff, length, dealt, usable, breakMinutes, card }) {
  const landing = takeoff + length
  return {
    boardAt,
    takeoff,
    landing,
    length,
    descentAt: landing - card.descent,
    // The phone never knows how you split your dots, and it doesn't need to: one dot
    // is the same size however they're spent.
    dotMinutes: Math.round((length - card.descent) / card.dots),
    card: dealt.name,
    cardMinutes: dealt.minutes,
    usable,
    general: Math.round(generalAmount(usable, card)),
    breakMinutes,
    mode: modeOf(breakMinutes),
  }
}

function pick(list, rng) {
  return list.length ? list[Math.floor(rng() * list.length)] : 0
}

function randomFirstBoarding(card, rng) {
  const steps = Math.floor((card.firstBoardingMax - card.firstBoardingMin) / 5)
  return card.firstBoardingMin + 5 * Math.floor(rng() * (steps + 1))
}

// ---- Laying the day ---------------------------------------------------------

export function planDay({ events, card, deck, rng, now = null }) {
  if (isClosedDay(events, card)) {
    return { status: "closed", flights: [], deck, closeAfter: null, firstBoarding: null, walls: [] }
  }

  const walls = findWalls(events, card)
  const from = now === null ? card.open : Math.max(card.open, now)
  const flights = []
  let left = card.budget
  let hand = deck

  laying: for (const gap of findGaps(walls, from, card.latestClose)) {
    // The next wall counts even past closing, so a landing always leaves the walk.
    const nextWall = walls.find(([start]) => start >= gap.end)
    const stand = nextWall ? Math.min(gap.end, nextWall[0] - card.walk) : gap.end

    // Ride the class: board as you walk out. With no class to ride, wait to be called.
    const classEnd = walls.filter(([, end]) => end <= gap.start).at(-1)?.[1] ?? null
    const riding = classEnd !== null && classEnd + card.walk > gap.start

    let boardAt
    let takeoff
    if (riding) {
      boardAt = Math.max(gap.start + 1, classEnd + card.boardDelay)
      takeoff = Math.max(boardAt, classEnd + card.walk)
    } else {
      const earliest = gap.start + card.settle
      const latest = stand - card.minUsable - card.settle
      const called = gap.start + randomFirstBoarding(card, rng)
      boardAt = Math.max(earliest, Math.min(called, latest))
      takeoff = boardAt + card.settle
    }

    // A real 4-hour break keeps flying, however late its first boarding was drawn.
    const firstTakeoff = riding ? takeoff : gap.start + 2 * card.settle
    const rolling = stand - firstTakeoff >= card.rollingGap

    // One flight at the front of the gap, or a chain on a long open stretch.
    for (;;) {
      const usable = stand - takeoff
      if (!(usable >= card.minUsable)) break
      if (flights.length >= card.maxFlights) break laying

      const { dealt, deck: nextHand } = dealCard(hand, card, rng)
      const length = flightLength(usable, dealt.minutes, card)
      if (length > left) break laying // the next flight won't fit, so the day just ends
      hand = nextHand

      const breakMinutes = gap.end - gap.start
      const flight = layFlight({ boardAt, takeoff, length, dealt, usable, breakMinutes, card })
      flights.push(flight)
      left -= length
      if (!rolling) break

      const rest = Math.max(card.restMin, Math.round(card.restShare * length))
      boardAt = flight.landing + rest + pick(card.restExtras, rng)
      takeoff = boardAt + card.settle
    }
  }

  return summarize({ flights, walls, deck: hand })
}

function summarize({ flights, walls, deck }) {
  const last = flights[flights.length - 1]
  return {
    status: flights.length ? "open" : "clear",
    flights,
    walls,
    deck,
    firstBoarding: flights.length ? flights[0].boardAt : null,
    closeAfter: last ? roundUpToHalfHour(last.landing) : null,
  }
}

// After the morning, a re-read can only remove flights. A class that gets canceled
// adds nothing, so the count can only fall and that hour stays yours.
//
// One allowed exception: a flight already called keeps its Down line even if a
// class just appeared on top of it, because the phone can't know you're not on it.
export function scrub(plan, events, card, now) {
  if (plan.status !== "open") return plan
  const closed = isClosedDay(events, card)
  const walls = findWalls(events, card)
  const flights = plan.flights.filter((f) => {
    if (f.boardAt <= now) return true
    if (closed) return false
    const needsClearUntil = f.landing + card.walk
    return !walls.some(([start, end]) => start < needsClearUntil && end > f.boardAt)
  })
  const scrubbed = summarize({ flights, walls, deck: plan.deck })
  return plan.declaredUntil === undefined ? scrubbed : { ...scrubbed, declaredUntil: plan.declaredUntil }
}

// ---- "Free until?" ----------------------------------------------------------

// A long day is the same planner with a second set of numbers: it starts now, it ends
// when you said, the daily limits lift, and it always keeps flying. Walls, walks, the
// deck and the longest card all still apply, so every leg is one real plane.
export function longDayCard(card, now, until) {
  return {
    ...card,
    open: now,
    latestClose: until,
    budget: Infinity,
    maxFlights: Infinity,
    rollingGap: 0,
    share: card.longDay.share,
    restMin: card.longDay.ground,
    restShare: 0,
    restExtras: [0],
    firstBoardingMin: 0,
    firstBoardingMax: 0,
  }
}

// The Tower can never add a flight, but you can, by naming when you're free until.
// It replaces what's left of today. Once declared, a long day can only shrink.
export function freeUntil({ today, events, card, state, rng, now, until }) {
  const laid = state?.date === today ? state.plan : null

  if (laid?.declaredUntil !== undefined) {
    const end = Math.min(until, laid.declaredUntil)
    const flights = laid.flights.filter((f) => f.boardAt <= now || f.landing <= end)
    const plan = { ...summarize({ flights, walls: laid.walls, deck: laid.deck }), declaredUntil: end }
    return { plan, state: { ...state, plan } }
  }

  // A flight already in the air keeps flying, so the long day starts after it lands.
  const flying = laid?.flights.find((f) => f.boardAt <= now && now < f.landing)
  const start = flying ? flying.landing + card.longDay.ground : now

  const plan = planDay({ events, card: longDayCard(card, start, until), deck: state?.deck ?? null, rng, now: start })
  if (plan.status === "closed") return { plan, state: state ?? null }
  const flights = flying ? [flying, ...plan.flights] : plan.flights
  const declared = { ...summarize({ flights, walls: plan.walls, deck: plan.deck }), declaredUntil: until }
  return { plan: declared, state: { date: today, plan: declared, deck: plan.deck } }
}

// What the screen shows before you press, so 6 hours can't quietly turn into 2.
export function longDaySummary(plan) {
  return {
    legs: plan.flights.length,
    air: plan.flights.reduce((sum, f) => sum + f.length, 0),
    down: plan.flights.length ? plan.flights.at(-1).landing : null,
  }
}

// Stand down: nothing else boards today, and nothing else pings.
export function standDown(state, now) {
  const flights = state.plan.flights.filter((f) => f.landing <= now)
  const plan = { ...summarize({ flights, walls: state.plan.walls, deck: state.plan.deck }), status: "closed" }
  return { ...state, plan }
}

// ---- The daily run ----------------------------------------------------------

// The whole morning decision. `state` is the little the phone saves: today's date,
// today's plan and the deck. Nothing about whether a flight was flown is kept.
// `calendars` is the list of names the phone can see.
// `retry` means you tapped to run it yourself, the only thing that can undo "unknown".
export function tower({ today, events, nextSevenDays, calendars, card, state, rng, now = null, retry = false }) {
  if (card.seasonEnds && today > card.seasonEnds) {
    return { plan: { status: "off", flights: [] }, state: state ?? null, fresh: false }
  }

  const laid = state?.date === today && state.plan ? state.plan : null
  if (laid && now === null) throw new Error("A same-day run needs the current time")

  const canSee = canSeeCalendar(nextSevenDays, card, calendars)

  if (laid && laid.status !== "unknown") {
    if (!canSee) return { plan: laid, state, fresh: false } // one bad read isn't news
    const plan = scrub(laid, events, card, now)
    return { plan, state: { ...state, plan }, fresh: false }
  }
  if (laid && !retry) return { plan: laid, state, fresh: false } // a dark day stays dark

  if (!canSee) {
    const plan = { status: "unknown", flights: [], deck: state?.deck ?? null }
    return { plan, state: { date: today, plan, deck: plan.deck }, fresh: true }
  }

  const plan = planDay({ events, card, deck: state?.deck ?? null, rng, now })
  return { plan, state: { date: today, plan, deck: plan.deck }, fresh: true }
}

// ---- Turning a plan into pings ----------------------------------------------

export function say(template, vars, fallback = "") {
  const text = (template ?? "").trim() || fallback
  return text.replace(/\{(\w+)\}/g, (_, key) => (Object.hasOwn(vars, key) ? String(vars[key]) : ""))
}

export function forecastLine(plan, card) {
  const { lines } = card
  if (plan.status === "open") {
    return say(
      lines.forecast,
      {
        count: plan.flights.length,
        first: clock(plan.firstBoarding),
        close: clock(plan.closeAfter),
      },
      "{count} / {first} / {close}",
    )
  }
  if (plan.status === "closed") return say(lines.closed, {}, "Closed")
  if (plan.status === "unknown") return say(lines.unknown, {}, "No read")
  return say(lines.clear, {}, "Clear")
}

// One forecast, then Boarding, Descent and Down for each flight. Every line reads the
// same whether or not you flew, so nothing has to be canceled by a tap.
export function pingsFor(plan, card) {
  const pings = []
  plan.flights.forEach((f, i) => {
    const next = plan.flights[i + 1]
    pings.push({
      at: f.boardAt,
      kind: "boarding",
      flight: i,
      text: say(
        card.lines.boarding,
        {
          land: clock(f.landing),
          general: f.general,
          length: f.length,
          dot: f.dotMinutes,
          card: f.card,
        },
        "{length} / {dot} / {land}",
      ),
    })
    pings.push({
      at: f.descentAt,
      kind: "descent",
      flight: i,
      text: say(card.lines.descent, { minutes: card.descent, land: clock(f.landing) }, "{land}"),
    })
    pings.push({
      at: f.landing,
      kind: "landing",
      flight: i,
      text: next
        ? say(card.lines.landingNext, { next: clock(next.boardAt) }, "{next}")
        : say(card.lines.landingLast, {}, "Closed"),
    })
  })
  return pings
}
