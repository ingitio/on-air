// The airline card. Every number and every word the phone says lives here.
// The code in tower.ts holds no wording and no personal rules.
//
// The numbers below are starting guesses. The lines are placeholders written by
// Claude, so they carry no weight yet: rewrite them in your own words before the
// first real ping. A blank line sends plain data only.

export const CARD = {
  // Calendars. You make both by hand in iPhone Calendar, in iCloud.
  onAirCalendar: "On Air", // the script writes here and nowhere else
  groundCalendar: "Ground", // yours: anything here is a wall; an all-day event here shuts the airport

  // Calendars the phone must still list before it trusts what it read. Left empty, it
  // only asks that something came back. Name one here if losing it should stop the day.
  mustSee: [],

  // The airport's hours, in minutes after midnight (8:30 am and 9:00 pm).
  open: 8 * 60 + 30,
  latestClose: 21 * 60,

  // Walking. 15 is the usual gap between classes.
  walk: 15,
  boardDelay: 5, // the ping comes this long after a class lets out
  settle: 5, // minutes to sit down when there was no class before

  // How much flying.
  cap: 60, // 3/4 of your 80-minute longest flight
  share: 0.6, // general amount is 60% of usable minutes, up to the cap
  budget: 180, // the most the Tower will call in a day; if the next flight won't fit, the day ends
  maxFlights: 3, // the most boardings in a day, because each start is the real cost
  minUsable: 45, // gaps with less usable time than this never fly
  minFlight: 25, // short cards round up to this, so a flight is always worth the plane pick
  rollingGap: 210, // usable minutes; a real 4-hour break keeps flying, with rest in between

  // Every flight, whatever the work, ends the same way: this long before Down, you
  // write the next crew's orders.
  descent: 6,

  // Every sticky spends this many dots, however you split them. Dots are shares, so
  // orders can be written before you know how long the next flight will be.
  dots: 6,

  // Rest on long gaps.
  restMin: 45,
  restShare: 0.75,
  restExtras: [0, 15, 30],
  firstBoardingMin: 30, // with no class to ride, the day's first boarding comes
  firstBoardingMax: 75, // this many minutes after the airport opens, if it still fits

  // Your seven cards. Name them whatever you like.
  deck: [
    { name: "Card 1", minutes: -30 },
    { name: "Card 2", minutes: -10 },
    { name: "Card 3", minutes: -10 },
    { name: "Card 4", minutes: -10 },
    { name: "Card 5", minutes: 0 },
    { name: "Card 6", minutes: 30 },
    { name: "Card 7", minutes: 30 },
  ],

  // A long day you ask for. "Free until?" uses these instead of the daily limits.
  longDay: {
    share: 0.85, // legs fill more of the window, because you asked for this day
    ground: 30, // minutes off the chair between legs
  },

  // After this date nothing boards by itself. Flights you ask for still work.
  seasonEnds: "2026-12-19",

  // The phone.
  name: "On Air", // the title on every ping
  morningCheck: 7 * 60 + 30, // if today isn't laid by now, one ping says so
  morningChecks: 3, // how many mornings ahead that ping is set
  lockShortcut: "On Air Lock", // the Shortcut the button runs once you've built it

  // The one button. It starts the flight, so it says what's true when you press it.
  button: "Computers out",

  // What's left once the phone is locked. Rewrite these on the Words screen.
  preCheck: ["Head: what's nagging me goes on a note", "Plane: first Estimated row landing by Down"],

  // Every line is true whether you flew or not. Rewrite these.
  lines: {
    forecast: "Expecting {count}. Nothing boards before {first}. Closed after {close}.",
    clear: "Nothing boarding today.",
    closed: "Airport closed today.",
    boarding: "Boarding. About {general} today, this one's {length}. {dot} minutes a dot. Down {land}.",
    descent: "Descent. {minutes} minutes to Down.",
    landingNext: "Down. Nothing boards before {next}.",
    landingLast: "Down. Airport closed.",
    unknown: "I can't read your calendars today, so nothing boards.",
    calendar: "Boarding {board}", // the title of the calendar block
    morning: "Today isn't laid yet. Tap to lay it.",
  },
}
