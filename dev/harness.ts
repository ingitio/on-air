// Bundled with the fake in place of the real app, so the tests and the code share one
// fake phone.

export * as phone from "../phone"
export * as fake from "./fake-scripting.mjs"
export { CARD } from "../card"
