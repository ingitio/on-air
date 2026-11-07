// A stand-in for the Scripting app, so the phone code can run on the PC. Views become
// plain objects, and the phone's calendars and pings become lists the tests can read.

export const Button = "Button"
export const DatePicker = "DatePicker"
export const HStack = "HStack"
export const NavigationStack = "NavigationStack"
export const ScrollView = "ScrollView"
export const Spacer = "Spacer"
export const Text = "Text"
export const TextField = "TextField"
export const TimerIntervalLabel = "TimerIntervalLabel"
export const Toggle = "Toggle"
export const VStack = "VStack"

export function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children }
}

// ---- A small renderer with hooks --------------------------------------------

const hooks = new Map()
let scope = null
let pendingEffects = []
let dirty = false

export function useState(initial) {
  const slot = scope.slots
  const i = scope.index++
  if (!(i in slot)) slot[i] = typeof initial === "function" ? initial() : initial
  return [
    slot[i],
    (value) => {
      slot[i] = value
      dirty = true
    },
  ]
}

export function useEffect(run, deps) {
  const slot = scope.slots
  const i = scope.index++
  const changed = !(i in slot) || !deps || deps.some((d, n) => d !== slot[i][n])
  if (changed) {
    slot[i] = deps ?? []
    pendingEffects.push(run)
  }
}

function build(node, path) {
  if (node === null || node === undefined || node === false || node === true) return []
  if (Array.isArray(node)) return node.flatMap((child, i) => build(child, `${path}.${child?.props?.key ?? i}`))
  if (typeof node !== "object") return [String(node)]
  if (typeof node.type === "function") {
    const outer = scope
    if (!hooks.has(path)) hooks.set(path, [])
    scope = { slots: hooks.get(path), index: 0 }
    const children = node.children.length === 1 ? node.children[0] : node.children
    const out = node.type({ ...node.props, children })
    scope = outer
    return build(out, `${path}>`)
  }
  return [{ type: node.type, props: node.props, children: build(node.children, path) }]
}

// Renders until the screen stops changing, letting async work land in between.
export async function render(element) {
  let tree
  for (let pass = 0; pass < 10; pass++) {
    dirty = false
    tree = build(element, "root")
    const effects = pendingEffects
    pendingEffects = []
    for (const run of effects) run()
    await new Promise((done) => setImmediate(done))
    if (!dirty && !pendingEffects.length) break
  }
  return tree
}

// ---- Reading a rendered screen ----------------------------------------------

export function textOf(tree) {
  return tree
    .flatMap((node) => {
      if (typeof node === "string") return [node]
      const own = node.type === "Button" && node.props.title ? [node.props.title] : []
      return [...own, ...(node.children.length ? [textOf(node.children)] : [])]
    })
    .join(" | ")
}

export function find(tree, test) {
  for (const node of tree) {
    if (typeof node === "string") continue
    if (test(node)) return node
    const inside = find(node.children, test)
    if (inside) return inside
  }
  return null
}

export function button(tree, label) {
  return find(tree, (n) => n.type === "Button" && (n.props.title === label || textOf(n.children) === label))
}

// ---- The phone --------------------------------------------------------------

export const world = {}

export function resetWorld(calendars = []) {
  world.calendars = calendars
  world.events = []
  world.pending = []
  world.storage = new Map()
  world.opened = []
  world.pasted = null
  world.confirm = true
  world.failRead = false
  world.refuse = false
  world.present = null
  world.exited = false
  world.alerts = []
  world.access = []
  world.saves = 0
  world.removes = 0
  hooks.clear()
}

export const Script = {
  name: "On Air",
  createRunSingleURLScheme: (name) => `scripting://run_single/${encodeURIComponent(name)}`,
  requestAccess: async (apis) => {
    world.access.push(...apis)
    return apis
  },
  exit: () => {
    world.exited = true
  },
}

export const Intent = { text: (value) => value }

export const Notification = {
  removeAllPendingsOfCurrentScript: async () => {
    world.pending = []
  },
  schedule: async (options) => {
    if (world.refuse) return false
    world.pending.push(options)
    return true
  },
}

export const Navigation = {
  useDismiss: () => () => world.present?.resolve(),
  present: (options) =>
    new Promise((resolve) => {
      world.present = { ...options, resolve }
    }),
}

export class FakeEvent {
  title = ""
  notes = null
  url = null
  calendar = null
  isAllDay = false
  availability = "busy"
  attendees = null
  alarms = []
  startDate = null
  endDate = null
  addAlarm(alarm) {
    this.alarms.push(alarm)
  }
  async save() {
    world.saves += 1
    if (!world.events.includes(this)) world.events.push(this)
  }
  async remove() {
    world.removes += 1
    world.events = world.events.filter((e) => e !== this)
  }
  static async getAll(start, end, calendars) {
    if (world.failRead) throw new Error("no access")
    return world.events.filter(
      (e) => e.startDate < end && e.endDate > start && (!calendars || calendars.includes(e.calendar)),
    )
  }
}

export function installGlobals() {
  globalThis.Storage = {
    get: (key) => (world.storage.has(key) ? JSON.parse(world.storage.get(key)) : null),
    set: (key, value) => {
      world.storage.set(key, JSON.stringify(value))
      return true
    },
    remove: (key) => world.storage.delete(key),
  }
  globalThis.Calendar = {
    forEvents: async () => {
      if (world.failRead) throw new Error("no access")
      return world.calendars
    },
  }
  globalThis.CalendarEvent = FakeEvent
  globalThis.EventAlarm = { fromRelativeOffset: (seconds) => ({ seconds }) }
  globalThis.TimeIntervalNotificationTrigger = class {
    constructor({ timeInterval, repeats }) {
      this.timeInterval = timeInterval
      this.repeats = repeats
    }
  }
  globalThis.Safari = {
    openURL: async (url) => {
      world.opened.push(url)
      return true
    },
  }
  globalThis.Pasteboard = {
    setString: async (text) => {
      world.pasted = text
    },
  }
  globalThis.Dialog = {
    confirm: async () => world.confirm,
    alert: async (options) => {
      world.alerts.push(options)
    },
  }
}

export function addEvent({ title, calendar, start, end, ...extra }) {
  const event = new FakeEvent()
  Object.assign(event, { title, calendar, startDate: start, endDate: end, ...extra })
  world.events.push(event)
  return event
}
