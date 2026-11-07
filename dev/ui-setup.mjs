import * as fake from "./fake-scripting.mjs"

fake.installGlobals()
fake.resetWorld()
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}
globalThis.__scenario?.(fake)
