// The phone code and the screens, run against a fake phone. `node --test` from the
// project folder.
//
// This proves the code keeps its promises to the calendar and the pings, and that every
// screen draws and every button works. It can't prove the real app behaves like the
// fake, so anything new still gets tried on the iPhone.

import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { mock, test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { buildSync } from "esbuild"

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, ".build")
mkdirSync(out, { recursive: true })

function bundle(entry, name) {
  const outfile = join(out, name)
  buildSync({
    entryPoints: [join(here, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    alias: { scripting: join(here, "fake-scripting.mjs") },
    jsx: "transform",
    jsxFactory: "__h",
    inject: [join(here, "jsx-shim.mjs")],
    logLevel: "silent",
  })
  return pathToFileURL(outfile).href
}

const { phone, fake, CARD } = await import(bundle("harness.ts", "harness.mjs"))
const { world } = fake
const uiBundle = bundle("harness-ui.ts", "harness-ui.mjs")

const calendar = (title, sourceTitle = "iCloud", type = "calDAV") => ({
  title,
  source: { title: sourceTitle, type },
  allowsContentModifications: true,
})

const onAir = calendar("On Air")
const ground = calendar("Ground")
const school = calendar("School", "Gmail")
const allCalendars = [school, onAir, ground]

// Monday Nov 9, 2026. Minutes after midnight into a real date.
const monday = (hours, minutes = 0) => new Date(2026, 10, 9, hours, minutes)
const onDay = (d, hours, minutes = 0) => new Date(2026, 10, d, hours, minutes)

function setUp() {
  fake.installGlobals()
  fake.resetWorld(allCalendars)
  // A normal Monday, so the calendars can be seen.
  fake.addEvent({ title: "Math", calendar: school, start: monday(14, 30), end: monday(15, 20) })
  fake.addEvent({ title: "Phys", calendar: school, start: monday(17, 45), end: monday(19) })
  fake.addEvent({ title: "Chem", calendar: school, start: onDay(10, 11, 15), end: onDay(10, 12, 30) })
}

const flightsOnCalendar = () => world.events.filter((e) => e.calendar === onAir)
const flightPings = () => world.pending.filter((p) => p.trigger && p.body !== CARD.lines.morning)

test("the morning run lays blocks and pings for each flight, and only in On Air", async () => {
  setUp()
  const { plan } = await phone.refresh({ date: monday(7, 30) })
  assert.equal(plan.status, "open")
  const blocks = flightsOnCalendar()
  assert.equal(blocks.length, plan.flights.length)
  assert.equal(flightPings().length, plan.flights.length * 3)
  blocks.forEach((block, i) => {
    const f = plan.flights[i]
    assert.equal(block.startDate.getTime(), new Date(2026, 10, 9, 0, f.boardAt).getTime())
    assert.equal(block.endDate.getTime(), new Date(2026, 10, 9, 0, f.landing).getTime())
    assert.match(block.title, /^Boarding \d+:\d\d$/)
    assert.equal(block.alarms.length, 1)
  })
  assert.equal(world.events.filter((e) => e.calendar === school).length, 3, "school calendar untouched")
})

test("every ping lands at its own minute, and only boarding opens the app", async () => {
  setUp()
  const now = monday(7, 30)
  const { plan } = await phone.refresh({ date: now })
  const first = plan.flights[0]
  const seconds = (first.boardAt - (7 * 60 + 30)) * 60
  const boarding = flightPings().find((p) => p.body.startsWith("Boarding"))
  assert.equal(boarding.trigger.timeInterval, seconds)
  assert.equal(boarding.interruptionLevel, "timeSensitive")
  assert.equal(boarding.trigger.repeats, false)
  assert.equal(boarding.tapAction.type, "openURL")
  assert.match(boarding.tapAction.url, /run_single/)
  assert.equal(flightPings().find((p) => p.body.startsWith("Descent")).tapAction, "none")
})

test("opening the app again changes nothing", async () => {
  setUp()
  const first = await phone.refresh({ date: monday(7, 30) })
  const saves = world.saves
  const blocks = flightsOnCalendar().map((e) => e.startDate.getTime())
  const pings = world.pending.map((p) => p.body)
  const second = await phone.refresh({ date: monday(7, 31) })
  assert.deepEqual(second.plan.flights, first.plan.flights)
  assert.equal(world.saves, saves, "no event saved twice")
  assert.equal(world.removes, 0)
  assert.deepEqual(flightsOnCalendar().map((e) => e.startDate.getTime()), blocks)
  assert.deepEqual(world.pending.map((p) => p.body), pings)
})

test("a ping that already passed is never set again", async () => {
  setUp()
  const { plan } = await phone.refresh({ date: monday(7, 30) })
  const f = plan.flights[0]
  await phone.refresh({ date: new Date(2026, 10, 9, 0, f.boardAt + 1) })
  assert.ok(flightPings().every((p) => p.trigger.timeInterval > 0))
  assert.equal(flightPings().length, plan.flights.length * 3 - 1)
})

test("three mornings ahead are covered, in case one never lays its day", async () => {
  setUp()
  await phone.refresh({ date: monday(7, 30) })
  const checks = world.pending.filter((p) => p.body === CARD.lines.morning)
  assert.equal(checks.length, CARD.morningChecks)
  assert.equal(checks[0].trigger.timeInterval, 24 * 3600)
  assert.match(checks[0].tapAction.url, /run_single/)
})

test("morning checks stop at the end of the season", async () => {
  setUp()
  const late = new Date(2026, 11, 18, 7, 30)
  fake.addEvent({ title: "Chem final", calendar: school, start: new Date(2026, 11, 18, 13, 30), end: new Date(2026, 11, 18, 15, 30) })
  await phone.refresh({ date: late })
  assert.equal(world.pending.filter((p) => p.body === CARD.lines.morning).length, 1)
})

test("a test event or anything else in On Air is left alone", async () => {
  setUp()
  const mine = fake.addEvent({ title: "Mine", calendar: onAir, start: monday(20), end: monday(20, 30) })
  await phone.refresh({ date: monday(7, 30) })
  await phone.standDownToday(monday(8))
  assert.ok(world.events.includes(mine))
})

test("a Google calendar that happens to be called On Air is never written to", async () => {
  setUp()
  world.calendars = [school, calendar("On Air", "Gmail"), ground]
  const { problems } = await phone.refresh({ date: monday(7, 30) })
  assert.equal(world.saves, 0)
  assert.match(problems.join(), /No writable On Air/)
})

test("stand down clears what's left, including a flight in the air", async () => {
  setUp()
  const { plan } = await phone.refresh({ date: monday(7, 30) })
  const f = plan.flights[0]
  await phone.standDownToday(new Date(2026, 10, 9, 0, f.boardAt + 5))
  assert.equal(flightsOnCalendar().length, 0)
  assert.equal(flightPings().length, 0)
  const again = await phone.refresh({ date: new Date(2026, 10, 9, 0, f.boardAt + 6) })
  assert.equal(again.plan.status, "closed")
})

test("Free until replaces the day on the phone, and a later block is taken off", async () => {
  setUp()
  world.events = []
  fake.addEvent({ title: "Chem", calendar: school, start: onDay(14, 11, 15), end: onDay(14, 12, 30) })
  const sat = onDay(14, 8)
  const morning = await phone.refresh({ date: sat })
  const read = await phone.readForFreeUntil(onDay(14, 13))
  const preview = phone.previewFreeUntil(read, 19 * 60, () => 0.5)
  assert.ok(preview.plan.flights.length >= 3)
  const problems = await phone.declareFreeUntil(preview, onDay(14, 13))
  assert.deepEqual(problems, [])
  const blocks = flightsOnCalendar().filter((e) => e.endDate > onDay(14, 13))
  assert.equal(blocks.length, preview.plan.flights.length)
  const stillToCome = preview.plan.flights.flatMap((f) => [f.boardAt, f.descentAt, f.landing]).filter((t) => t > 13 * 60)
  assert.equal(flightPings().length, stillToCome.length)
  assert.ok(morning.plan.status)
})

test("a calendar that can't be read leaves the day dark until you open the app", async () => {
  setUp()
  world.failRead = true
  const line = await phone.morning(monday(7, 30))
  assert.match(line, /can't read/)
  assert.equal(flightPings().length, 0)
  assert.equal(world.pending.filter((p) => p.body === line.split(" (")[0]).length, 1, "it says so as one ping")
  world.failRead = false
  const still = await phone.refresh({ retry: false, date: monday(7, 40) })
  assert.equal(still.plan.status, "unknown")
  const opened = await phone.refresh({ retry: true, date: monday(7, 41) })
  assert.equal(opened.plan.status, "open")
})

test("the morning line pings once, and only on the run that lays the day", async () => {
  setUp()
  const line = await phone.morning(monday(7, 30))
  const count = () => world.pending.filter((p) => p.body === line).length
  assert.equal(count(), 1)
  assert.equal(world.pending.find((p) => p.body === line).trigger, undefined, "goes out right away")
  await phone.morning(monday(7, 35))
  assert.equal(count(), 0)
})

test("refused pings are reported, not swallowed", async () => {
  setUp()
  world.refuse = true
  const { problems } = await phone.refresh({ date: monday(7, 30) })
  assert.match(problems.join(), /refused/)
})

test("the button records the press, and opens your Shortcut only once it's built", async () => {
  setUp()
  const { plan, card } = await phone.refresh({ date: monday(7, 30) })
  const f = plan.flights[0]
  await phone.pressBoard(f, card, new Date(2026, 10, 9, 0, f.boardAt + 12))
  assert.deepEqual(world.opened, [])
  assert.deepEqual(phone.loadPressed(), { date: "2026-11-09", boardAt: f.boardAt })
  assert.equal(phone.loadLog()[0].late, 12)
  phone.setLockReady(true)
  await phone.pressBoard(f, card, new Date(2026, 10, 9, 0, f.boardAt + 13))
  assert.deepEqual(world.opened, ["shortcuts://run-shortcut?name=On%20Air%20Lock"])
})

test("your words reach the next ping", async () => {
  setUp()
  await phone.refresh({ date: monday(7, 30) })
  const words = phone.loadWords()
  phone.saveWords({ ...words, button: "Bag empty", lines: { ...words.lines, descent: "Mine. {minutes} left." } })
  const { card } = await phone.refresh({ date: monday(7, 31) })
  assert.equal(card.button, "Bag empty")
  assert.ok(flightPings().some((p) => p.body === "Mine. 6 left."))
})

test("a day is measured by the clock, even when the clocks change", () => {
  const day = phone.dayOf(new Date(2027, 2, 14, 12))
  assert.equal(day.at(180).getHours(), 3)
  assert.equal(day.at(780).getHours(), 13)
  assert.equal(day.today, "2027-03-14")
})

// ---- The screens ------------------------------------------------------------

let run = 0

async function openApp(date, scenario) {
  mock.timers.reset()
  mock.timers.enable({ apis: ["Date"], now: date.getTime() })
  const fakeOf = {}
  globalThis.__scenario = (f) => {
    fakeOf.f = f
    f.resetWorld(allCalendars)
    f.addEvent({ title: "Math", calendar: school, start: monday(14, 30), end: monday(15, 20) })
    f.addEvent({ title: "Phys", calendar: school, start: monday(17, 45), end: monday(19) })
    scenario?.(f)
  }
  await import(`${uiBundle}?run=${++run}`)
  await new Promise((done) => setImmediate(done))
  await new Promise((done) => setImmediate(done))
  const f = fakeOf.f
  return { f, world: f.world, screen: () => f.render(f.world.present.element) }
}

function done() {
  mock.timers.reset()
}

test("the app opens on the next boarding and the whole day", async () => {
  const app = await openApp(monday(7, 30))
  assert.deepEqual(app.world.access, ["calendar", "clipboard"])
  assert.equal(app.world.present.modalPresentationStyle, "fullScreen")
  const text = app.f.textOf(await app.screen())
  assert.match(text, /NEXT BOARDING/)
  assert.match(text, /TODAY/)
  assert.match(text, /Free until/)
  assert.match(text, /Stand down/)
  done()
})

test("at boarding there's one button, and pressing it puts you on air", async () => {
  const app = await openApp(monday(7, 30))
  const { plan } = JSON.parse(app.world.storage.get("state"))
  const f = plan.flights[0]
  const saved = app.world.storage.get("state")
  const later = await openApp(new Date(2026, 10, 9, 0, f.boardAt + 3), (again) => {
    again.world.storage.set("state", saved)
  })
  let tree = await later.screen()
  assert.match(later.f.textOf(tree), /BOARDING/)
  assert.match(later.f.textOf(tree), new RegExp(`${f.length} minutes\\. ${f.dotMinutes} minutes a dot`))
  assert.match(later.f.textOf(tree), /Head:/)
  assert.ok(!/NEXT BOARDING/.test(later.f.textOf(tree)))
  const press = later.f.button(tree, CARD.button)
  assert.ok(press, "the button is on screen")
  await press.props.action()
  tree = await later.screen()
  const text = later.f.textOf(tree)
  assert.match(text, /ON AIR/)
  assert.ok(!later.f.button(tree, CARD.button), "the button is gone once you've pressed")
  assert.ok(later.f.find(tree, (n) => n.type === "TimerIntervalLabel"), "the countdown is running")
  done()
})

test("the Free until screen previews legs, lays them and comes back", async () => {
  const sat = new Date(2026, 10, 14, 12, 3)
  const app = await openApp(sat)
  let tree = await app.screen()
  app.f.button(tree, "Free until").props.action()
  tree = await app.screen()
  assert.match(app.f.textOf(tree), /FREE UNTIL/)
  const wheel = app.f.find(tree, (n) => n.type === "DatePicker")
  assert.deepEqual(wheel.props.displayedComponents, ["hourAndMinute"])
  wheel.props.onChanged(new Date(2026, 10, 14, 18, 0).getTime())
  tree = await app.screen()
  assert.match(app.f.textOf(tree), /4 legs|3 legs/)
  await app.f.button(tree, "Lay these legs").props.action()
  tree = await app.screen()
  assert.match(app.f.textOf(tree), /TODAY/)
  assert.ok(app.world.events.filter((e) => e.notes).length >= 3)
  done()
})

test("the Words screen saves what you wrote", async () => {
  const app = await openApp(monday(7, 30))
  let tree = await app.screen()
  app.f.button(tree, "Words").props.action()
  tree = await app.screen()
  assert.match(app.f.textOf(tree), /YOUR WORDS/)
  const field = (title) => app.f.find(tree, (n) => n.type === "TextField" && n.props.title === title)
  field("The button").props.onChanged("Bag empty")
  tree = await app.screen()
  await app.f.button(tree, "Copy log").props.action()
  tree = await app.screen()
  assert.ok(app.f.button(tree, "Copied"))
  assert.equal(app.world.pasted, "[]")
  await app.f.button(tree, "Save").props.action()
  tree = await app.screen()
  assert.match(app.f.textOf(tree), /NEXT BOARDING/)
  assert.equal(JSON.parse(app.world.storage.get("words")).button, "Bag empty")
  done()
})

test("stand down asks first, and clears the day", async () => {
  const app = await openApp(monday(7, 30))
  let tree = await app.screen()
  app.world.confirm = false
  await app.f.button(tree, "Stand down").props.action()
  tree = await app.screen()
  assert.match(app.f.textOf(tree), /NEXT BOARDING/)
  app.world.confirm = true
  await app.f.button(tree, "Stand down").props.action()
  tree = await app.screen()
  assert.match(app.f.textOf(tree), /GROUND/)
  assert.match(app.f.textOf(tree), /Airport closed/)
  done()
})

test("Close ends the script", async () => {
  const app = await openApp(monday(7, 30))
  await app.screen()
  app.world.present.resolve()
  await new Promise((done2) => setImmediate(done2))
  await new Promise((done2) => setImmediate(done2))
  assert.equal(app.world.exited, true)
  done()
})

test("a problem at startup shows up instead of a blank screen", async () => {
  const app = await openApp(monday(7, 30), (f) => {
    globalThis.Storage.get = () => {
      throw new Error("storage is broken")
    }
    f.world.present = null
  })
  await new Promise((done2) => setImmediate(done2))
  assert.equal(app.world.alerts.length, 1)
  assert.match(app.world.alerts[0].message, /storage is broken/)
  done()
})
