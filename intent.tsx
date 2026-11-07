// The morning run. Your Shortcut's Run Script action lands here, with no screen.

import { Intent, Script } from "scripting"
import { morning } from "./phone"

morning()
  .then((line) => Script.exit(Intent.text(line)))
  .catch((error) => Script.exit(Intent.text(`On Air failed: ${String(error)}`)))
