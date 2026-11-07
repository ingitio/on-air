// On Air preflight. In the Scripting app, make a new script named Preflight, paste
// this whole file over index.tsx, and press Run.
//
// It reads your calendars, adds one test event to On Air, and sets two test pings.
// It deletes nothing and never writes to any calendar except On Air.
// The report holds counts per calendar, never event titles.

import { Script, Notification } from "scripting"

const ON_AIR = "On Air"
const GROUND = "Ground"
const TEST_TITLE = "On Air test, safe to delete"
const ORD_BOARD = "https://www.flightradar24.com/data/airports/ord/arrivals"

const report: string[] = ["ON AIR PREFLIGHT"]
const note = (line: string) => report.push(line)

function clockTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

async function step(name: string, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    note(`FAILED ${name}: ${String(error)}`)
  }
}

// Yours, in iCloud or only on the phone. Never a Google calendar.
function isPrivateToPhone(calendar: any) {
  const source = calendar.source
  const inICloud = source?.type === "calDAV" && String(source?.title).toLowerCase() === "icloud"
  return inICloud || source?.type === "local"
}

function canWriteTo(calendar: any) {
  return isPrivateToPhone(calendar) && calendar.allowsContentModifications
}

async function setPing(name: string, when: Date, options: any) {
  const scheduled = await Notification.schedule(options)
  note(scheduled === false ? `FAILED ${name}: the phone refused it` : `${name} set for ${clockTime(when)}`)
}

async function main() {
  // The button on test ping 2 lands here.
  if (Script.queryParameters?.button) {
    await Dialog.alert({
      title: "Button worked",
      message: "A ping's button can reach a script on this phone.",
    })
    return
  }

  await step("phone info", async () => {
    note(`${Device.systemName} ${Device.systemVersion}, Scripting ${Device.appVersion}`)
    note(`Paid features unlocked: ${Script.hasFullAccess() ? "yes" : "no"}`)
  })

  await step("permission", async () => {
    const granted = await Script.requestAccess(["calendar", "clipboard"])
    note(`Access granted: ${granted.join(", ") || "none listed"}`)
  })

  let calendars: any[] = []
  await step("listing calendars", async () => {
    calendars = await Calendar.forEvents()
    note("")
    note(`Calendars this app can see: ${calendars.length}`)
  })

  await step("reading the next 7 days", async () => {
    const start = new Date()
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
    const events = await CalendarEvent.getAll(start, end)

    type Row = { name: string; timed: number; allDay: number; free: number; declined: number; noFreeBusy: number }
    const rows = new Map<string, Row>()
    const blank = (name: string): Row => ({ name, timed: 0, allDay: 0, free: 0, declined: 0, noFreeBusy: 0 })
    for (const calendar of calendars) {
      rows.set(calendar.identifier, blank(`${calendar.title} [${calendar.source?.title}, ${calendar.source?.type}]`))
    }
    for (const event of events) {
      const key = event.calendar?.identifier ?? "none"
      const row = rows.get(key) ?? blank("(no calendar)")
      if (event.isAllDay) row.allDay += 1
      else row.timed += 1
      if (event.availability === "free") row.free += 1
      if (event.availability === "notSupported") row.noFreeBusy += 1
      if (event.attendees?.some((a: any) => a.isCurrentUser && a.status === "declined")) row.declined += 1
      rows.set(key, row)
    }
    for (const row of rows.values()) {
      note(
        `${row.name}: ${row.timed} timed, ${row.allDay} all-day, ` +
          `${row.free} free, ${row.declined} declined, ${row.noFreeBusy} no free/busy`,
      )
    }
    note(`Total in the next 7 days: ${events.length}`)
  })

  const onAir = calendars.find((c) => c.title === ON_AIR && canWriteTo(c))
  const ground = calendars.find((c) => c.title === GROUND)
  note("")
  if (calendars.length === 0) {
    note("No calendars visible. Check Calendar access for Scripting in iPhone Settings.")
  } else {
    note(`${GROUND} calendar: ${ground ? `found in ${ground.source?.title}` : "not found"}`)
    note(`${ON_AIR} calendar: ${onAir ? `found in ${onAir.source?.title}` : "no writable one in iCloud"}`)
  }

  const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000)

  await step("test ping 1", () =>
    setPing("Ping 1", inMinutes(3), {
      title: "Test ping 1",
      body: "Time Sensitive. It should show even in Do Not Disturb.",
      interruptionLevel: "timeSensitive",
      trigger: new TimeIntervalNotificationTrigger({ timeInterval: 180, repeats: false }),
      tapAction: { type: "openURL", url: ORD_BOARD },
    }),
  )

  await step("test ping 2", () =>
    setPing("Ping 2", inMinutes(4), {
      title: "Test ping 2",
      body: "Normal level. Do Not Disturb should hide it for now.",
      interruptionLevel: "active",
      trigger: new TimeIntervalNotificationTrigger({ timeInterval: 240, repeats: false }),
      tapAction: "none",
      actions: [
        {
          title: "Test button",
          url: Script.createRunSingleURLScheme(Script.name, { button: "yes" }),
        },
      ],
    }),
  )

  await step("counting pending pings", async () => {
    const pending = await Notification.getAllPendingsOfCurrentScript()
    note(`Pings waiting on the phone: ${pending.length}`)
  })

  await step("test event", async () => {
    if (!onAir) {
      note(`No test event: nothing was written to any calendar`)
      return
    }
    const when = inMinutes(5)
    const event = new CalendarEvent()
    event.title = TEST_TITLE
    event.calendar = onAir
    event.startDate = when
    event.endDate = new Date(when.getTime() + 5 * 60 * 1000)
    event.url = ORD_BOARD
    event.addAlarm(EventAlarm.fromRelativeOffset(0))
    await event.save()
    note(`Test event saved, its alert should fire at ${clockTime(when)}`)
  })

  note("")
  note("Now: lock the phone, turn on Silent, Do Not Disturb and Airplane Mode, and swipe Scripting away.")
  note("After the alert at minute 5: turn all three off, tap Test ping 1 (the Chicago board should open), then long-press Test ping 2 and press its button.")

  let copied = false
  await step("copying the report", async () => {
    await Pasteboard.setString(report.join("\n"))
    copied = true
  })
  await Dialog.alert({
    title: copied ? "Report copied" : "Report NOT copied",
    message: report.join("\n"),
  })
}

main()
  .catch((error) => console.error(error))
  .finally(() => Script.exit())
