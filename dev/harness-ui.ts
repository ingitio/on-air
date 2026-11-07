// Opens the real app screen on the fake phone. A test sets up the day in
// globalThis.__scenario, which runs before index.tsx does.

import "./ui-setup.mjs"
import "../index"

export * as fake from "./fake-scripting.mjs"
