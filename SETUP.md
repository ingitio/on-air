# Setting up On Air

Part 1 gets you flying today. Parts 2 and 3 can wait until you've felt a real flight.

## Part 1: Get the app (2 minutes)

1. Open Scripting and open your Preflight script.
2. Replace everything in its `index.tsx` with these three lines:

   ```tsx
   import { Script } from "scripting"
   const link = Script.createImportScriptsURLScheme(["https://github.com/ingitio/on-air"])
   Safari.openURL(link).finally(() => Script.exit())
   ```

3. Press Run, and accept the import.
4. Open On Air and press Run. Allow Calendar access if it asks.

You should see your next boarding. Open iPhone Calendar and the flights are there too.

## Part 2: Lock your phone during flights (6 minutes)

### The wallpaper

1. Save [the wallpaper](assets/on-air-wallpaper.png) to Photos.
2. Touch and hold your Lock Screen, press +, choose Photos, and pick it. Press Add, then Set as Wallpaper Pair.
3. Swipe back to your normal Lock Screen.

### The Focus

1. Go to Settings > Focus, press +, choose Custom, and name it `On Air`.
2. Press Customize Focus.
3. Under Allow Notifications, open Apps. Add **Scripting**, and turn on **Time Sensitive Notifications**. This keeps Descent and Down coming through.
4. Under Customize Screens, press Choose under the Lock Screen and pick your wallpaper.

### The Shortcut

In Shortcuts, make a new shortcut named exactly `On Air Lock`, with these actions in order:

1. **Find Calendar Events.** Add three filters:
   - Calendar is On Air
   - Start Date is in the last 3 hours
   - End Date is in the next 3 hours
2. **If** Calendar Events has any value
3. Inside the If: **Get Details of Calendar Events**, set to End Date
4. Inside the If: **Set Focus**. Turn On Air on, Until Time, and set the time to the End Date from step 3.
5. Inside the If: **Lock Screen**

Run it once by hand and allow Calendar access. Nothing happens if no flight is on, which is correct.

### The automation

1. In Shortcuts, open Automation and press +.
2. Choose App, press Choose, and tick your distracting apps. You pick these. Keep Is Opened on.
3. Choose Run Immediately, and turn Notify When Run off. Press Next.
4. Pick `On Air Lock`.

### Tell On Air it's built

In On Air, open Words, turn on **My On Air Lock shortcut is built**, and press Save.

### Test it

1. In On Air, press Free until and pick a time about an hour from now. Press Lay these legs.
2. In about 5 minutes, Boarding pings.
3. Open one of your blocked apps. The phone should lock and show your wallpaper.

## Part 3: Lay each morning by itself (2 minutes)

1. In Shortcuts, open Automation and press +.
2. Choose Time of Day, set 7:00 AM, Daily, and Run Immediately. Press Next.
3. Choose New Blank Automation and add **Run Script** from Scripting. Pick On Air.

If On Air isn't in the list, open it in Scripting, tap its title at the top of the editor, open Intent Settings and tick Text. Then try again.

If a morning ever fails, a ping at 7:30 tells you to tap it.

## Words

Everything the phone says is yours to rewrite. Open On Air and press Words.
