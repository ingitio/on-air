// The app you open. One screen that shows where the day stands, one big button when
// it's time, and two side screens: Free until and Words.

import {
  Button,
  DatePicker,
  HStack,
  Navigation,
  NavigationStack,
  Script,
  ScrollView,
  Spacer,
  Text,
  TextField,
  TimerIntervalLabel,
  Toggle,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { clock, forecastLine, longDaySummary, seeded, span } from "./tower"
import {
  dayOf,
  declareFreeUntil,
  loadLog,
  loadPressed,
  loadWords,
  lockIsReady,
  pressBoard,
  previewFreeUntil,
  readForFreeUntil,
  refresh,
  saveWords,
  setLockReady,
  standDownToday,
} from "./phone"

const AMBER = "#FFB000"
const DIM = "#8E8E93"

function Label({ text, color = AMBER }) {
  return (
    <Text font="caption" fontWeight="semibold" kerning={2} foregroundStyle={color}>
      {text}
    </Text>
  )
}

function Big({ text }) {
  return (
    <Text font={64} fontWeight="bold" fontDesign="monospaced" minScaleFactor={0.5} lineLimit={1}>
      {text}
    </Text>
  )
}

function Lines({ lines }) {
  return (
    <VStack alignment="leading" spacing={8}>
      {lines
        .filter((line) => line.trim())
        .map((line) => (
          <Text key={line} foregroundStyle={DIM}>
            {line}
          </Text>
        ))}
    </VStack>
  )
}

function Countdown({ to }) {
  return (
    <TimerIntervalLabel
      from={Math.min(Date.now(), to)}
      to={to}
      font={64}
      fontWeight="bold"
      fontDesign="monospaced"
      minScaleFactor={0.5}
      lineLimit={1}
    />
  )
}

// A flight has been called. Press when it's true.
function Boarding({ flight, card, onPress }) {
  return (
    <VStack alignment="leading" spacing={16}>
      <Label text="BOARDING" />
      <Big text={`Down ${clock(flight.landing)}`} />
      <Text>{`${flight.length} minutes. ${flight.dotMinutes} minutes a dot.`}</Text>
      <Button action={onPress} buttonStyle="borderedProminent" controlSize="extraLarge" tint={AMBER}>
        <Text font={22} fontWeight="bold" foregroundStyle="black" frame={{ maxWidth: "infinity" }}>
          {card.button}
        </Text>
      </Button>
      <Lines lines={card.preCheck} />
    </VStack>
  )
}

// You pressed. The phone has nothing left to say until Descent.
function InFlight({ flight, card, day }) {
  return (
    <VStack alignment="leading" spacing={16}>
      <Label text="ON AIR" />
      <Countdown to={day.at(flight.landing).getTime()} />
      <Text>{`Down ${clock(flight.landing)}. ${flight.dotMinutes} minutes a dot.`}</Text>
      <Lines lines={card.preCheck} />
    </VStack>
  )
}

function Ground({ plan, card, next }) {
  return (
    <VStack alignment="leading" spacing={16}>
      <Label text={next ? "NEXT BOARDING" : "GROUND"} />
      {next ? <Big text={clock(next.boardAt)} /> : null}
      <Text>{forecastLine(plan, card)}</Text>
    </VStack>
  )
}

function Row({ flight, now }) {
  const past = flight.landing <= now
  return (
    <HStack>
      <Text fontDesign="monospaced" foregroundStyle={past ? DIM : "white"}>
        {clock(flight.boardAt)}
      </Text>
      <Spacer />
      <Text fontDesign="monospaced" foregroundStyle={DIM}>
        {`Down ${clock(flight.landing)}`}
      </Text>
    </HStack>
  )
}

function Board({ data, now, onPress, onStandDown, onFree, onWords }) {
  const { plan, card, day, problems } = data
  const flights = plan.flights
  const current = flights.find((f) => f.boardAt <= now && now < f.landing)
  const next = flights.find((f) => f.boardAt > now)
  const pressed = loadPressed()
  const boarded = current && pressed?.date === day.today && pressed?.boardAt === current.boardAt

  return (
    <ScrollView>
      <VStack alignment="leading" spacing={28} padding={20} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        {current ? (
          boarded ? (
            <InFlight flight={current} card={card} day={day} />
          ) : (
            <Boarding flight={current} card={card} onPress={() => onPress(current)} />
          )
        ) : (
          <Ground plan={plan} card={card} next={next} />
        )}

        {flights.length ? (
          <VStack alignment="leading" spacing={8}>
            <Label text="TODAY" color={DIM} />
            {flights.map((f) => (
              <Row key={f.boardAt} flight={f} now={now} />
            ))}
          </VStack>
        ) : null}

        {problems.map((problem) => (
          <Text key={problem} font="footnote" foregroundStyle="systemRed">
            {problem}
          </Text>
        ))}

        <HStack spacing={12}>
          <Button title="Free until" buttonStyle="bordered" action={onFree} />
          {current || next ? <Button title="Stand down" buttonStyle="bordered" action={onStandDown} /> : null}
          <Spacer />
          <Button title="Words" buttonStyle="borderless" action={onWords} />
        </HStack>
      </VStack>
    </ScrollView>
  )
}

function defaultUntil(day) {
  const threeHours = Math.ceil((day.now + 180) / 15) * 15
  return day.at(Math.min(threeHours, 23 * 60 + 45)).getTime()
}

function FreeUntil({ onLaid, onBack }) {
  const [read, setRead] = useState(null)
  const [until, setUntil] = useState(0)
  const [seed] = useState(() => Math.floor(Math.random() * 2147483647))
  const [problems, setProblems] = useState([])

  useEffect(() => {
    readForFreeUntil().then((result) => {
      setUntil(defaultUntil(result.day))
      setRead(result)
    })
  }, [])

  if (!read) return <Text padding={20}>Reading your day</Text>

  const picked = new Date(until)
  const result = previewFreeUntil(read, dayOf(picked).now, seeded(seed))
  const closed = result.plan.status === "closed"
  const { legs, air, down } = longDaySummary(result.plan)

  const lay = async () => {
    const trouble = await declareFreeUntil(result)
    if (trouble.length) setProblems(trouble)
    else onLaid()
  }

  return (
    <ScrollView>
      <VStack alignment="leading" spacing={20} padding={20} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Label text="FREE UNTIL" />
        <DatePicker
          title="Free until"
          value={until}
          onChanged={setUntil}
          displayedComponents={["hourAndMinute"]}
          datePickerStyle="wheel"
        />
        {closed ? (
          <Text>{forecastLine(result.plan, read.card)}</Text>
        ) : (
          <Text>{legs ? `${legs} legs, ${span(air)} in the air, last Down ${clock(down)}` : "No leg fits."}</Text>
        )}
        <VStack alignment="leading" spacing={8}>
          {closed
            ? null
            : result.plan.flights.map((f, i) => (
                <HStack key={f.boardAt}>
                  <Text fontDesign="monospaced">{clock(f.boardAt)}</Text>
                  <Spacer />
                  <Text fontDesign="monospaced" foregroundStyle={DIM}>
                    {`${f.length} min, ${f.dotMinutes} a dot, Down ${clock(f.landing)}`}
                  </Text>
                </HStack>
              ))}
        </VStack>
        <Text font="footnote" foregroundStyle={DIM}>
          This replaces the rest of today. Once it's set, it can only get shorter.
        </Text>
        {problems.map((problem) => (
          <Text key={problem} font="footnote" foregroundStyle="systemRed">
            {problem}
          </Text>
        ))}
        <HStack spacing={12}>
          <Button
            title="Lay these legs"
            buttonStyle="borderedProminent"
            tint={AMBER}
            disabled={closed || !legs}
            action={lay}
          />
          <Button title="Back" buttonStyle="bordered" action={onBack} />
        </HStack>
      </VStack>
    </ScrollView>
  )
}

function Field({ title, value, onChanged }) {
  return (
    <VStack alignment="leading" spacing={4}>
      <Text font="caption" foregroundStyle={DIM}>
        {title}
      </Text>
      <TextField
        title={title}
        value={value}
        onChanged={onChanged}
        axis="vertical"
        lineLimit={{ min: 1, max: 4 }}
        textFieldStyle="roundedBorder"
      />
    </VStack>
  )
}

function Words({ onSaved, onBack }) {
  const [words, setWords] = useState(loadWords)
  const [ready, setReady] = useState(lockIsReady)
  const [copied, setCopied] = useState(false)

  const setLine = (key) => (value) => setWords({ ...words, lines: { ...words.lines, [key]: value } })
  const setCheck = (i) => (value) => {
    const preCheck = [...words.preCheck]
    preCheck[i] = value
    setWords({ ...words, preCheck })
  }

  const copyLog = async () => {
    await Pasteboard.setString(JSON.stringify(loadLog(), null, 1))
    setCopied(true)
  }

  const save = () => {
    saveWords(words)
    setLockReady(ready)
    onSaved()
  }

  return (
    <ScrollView>
      <VStack alignment="leading" spacing={16} padding={20} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Label text="YOUR WORDS" />
        <Field title="The button" value={words.button} onChanged={(button) => setWords({ ...words, button })} />
        <Field title="After the button, line 1" value={words.preCheck[0] ?? ""} onChanged={setCheck(0)} />
        <Field title="After the button, line 2" value={words.preCheck[1] ?? ""} onChanged={setCheck(1)} />
        <Field title="After the button, line 3" value={words.preCheck[2] ?? ""} onChanged={setCheck(2)} />
        <Field title="Boarding ping" value={words.lines.boarding} onChanged={setLine("boarding")} />
        <Field title="Descent ping" value={words.lines.descent} onChanged={setLine("descent")} />
        <Field title="Down ping, with more flights to come" value={words.lines.landingNext} onChanged={setLine("landingNext")} />
        <Field title="Down ping, last of the day" value={words.lines.landingLast} onChanged={setLine("landingLast")} />
        <Text font="footnote" foregroundStyle={DIM}>
          {"Curly words fill themselves in: {length}, {dot}, {land} and {general} on Boarding, {minutes} on Descent, {next} on Down."}
        </Text>
        <Toggle title="My On Air Lock shortcut is built" value={ready} onChanged={setReady} />
        <HStack spacing={12}>
          <Button title="Save" buttonStyle="borderedProminent" tint={AMBER} action={save} />
          <Button title="Back" buttonStyle="bordered" action={onBack} />
          <Spacer />
          <Button title={copied ? "Copied" : "Copy log"} buttonStyle="borderless" action={copyLog} />
        </HStack>
      </VStack>
    </ScrollView>
  )
}

function App({ opened }) {
  const dismiss = Navigation.useDismiss()
  const [data, setData] = useState(opened)
  const [screen, setScreen] = useState("board")
  const [tick, setTick] = useState(() => Date.now())

  const reload = async () => setData(await refresh())

  // Keeps the screen honest while it's open, and lays a new day past midnight.
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 20000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (dayOf(new Date(tick)).today !== data.day.today) reload()
  }, [tick])

  const press = async (flight) => {
    await pressBoard(flight, data.card)
    setTick(Date.now())
  }

  const stand = async () => {
    const sure = await Dialog.confirm({
      title: "Stand down?",
      message: "Nothing else boards today.",
      cancelLabel: "Keep flying",
      confirmLabel: "Stand down",
    })
    if (!sure) return
    await standDownToday()
    await reload()
  }

  const backToBoard = async () => {
    await reload()
    setScreen("board")
  }

  return (
    <NavigationStack preferredColorScheme="dark">
      <VStack
        navigationTitle="On Air"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ topBarTrailing: <Button title="Close" action={dismiss} /> }}
      >
        {screen === "free" ? (
          <FreeUntil onLaid={backToBoard} onBack={() => setScreen("board")} />
        ) : screen === "words" ? (
          <Words onSaved={backToBoard} onBack={() => setScreen("board")} />
        ) : (
          <Board
            data={data}
            now={dayOf(new Date(tick)).now}
            onPress={press}
            onStandDown={stand}
            onFree={() => setScreen("free")}
            onWords={() => setScreen("words")}
          />
        )}
      </VStack>
    </NavigationStack>
  )
}

async function main() {
  await Script.requestAccess(["calendar", "clipboard"])
  const opened = await refresh()
  await Navigation.present({ element: <App opened={opened} />, modalPresentationStyle: "fullScreen" })
}

// The morning Shortcut imports the phone code, never this file, so this only runs
// when you open the app.
main()
  .catch((error) => Dialog.alert({ title: "On Air hit a problem", message: String(error) }))
  .finally(() => Script.exit())
