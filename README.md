# CrabbyBurner

Claude usage on an old phone next to your PC, with a crab.

CrabbyBurner turns a spare phone into a desk display for your Claude plan.
It shows the 5-hour session as a strip of sand burning from the left with a
crab living on it, plus this week's limit, today's tokens and what Claude is
working on right now. It can also pick up the Claude Code sessions the 5-hour
limit cut off as soon as the limit resets, so you don't have to type
"continue" in each one yourself.

A small server runs on your PC and reads what Claude Code already keeps
there. The phone shows it over your Wi-Fi.

> CrabbyBurner is a fan project, not affiliated with Anthropic. It only uses
> your own Claude Code login on your own PC.

## What you need

- A PC with [Claude Code](https://code.claude.com) installed and logged in with
  a Claude Pro or Max plan. The `claude` command must work in a terminal.
- [Node.js](https://nodejs.org) 22.2 or newer.
- A phone on the same Wi-Fi as the PC. Any phone with a browser works; for
  Android there is also an app.

Built and tested on Windows 11. The server is plain Node and should also run on
Linux and macOS, but on macOS Claude Code keeps its login in the Keychain
instead of `~/.claude/.credentials.json`, so the plan limits (the percentages)
won't show there. The token counts will.

## Install and start

```sh
git clone https://github.com/svdockum/crabbyburner.git
cd crabbyburner
npm start
```

There is nothing to `npm install`: the server has no dependencies.

The window then shows:

- the address for your phone, like `http://192.168.2.2:2722`;
- whether auto-continue is on;
- the six-digit **phone code** the app asks for before it changes anything.

The first time, Windows asks whether Node.js may use the network. Allow it on
**private networks**, or the phone can't reach the PC.

Keep this window open. Closing it stops the display and auto-continue.

## Set up the phone

### The web page (any phone)

Open the "Your phone" address from the PC window in the phone's browser. Use
the browser's **Add to Home screen** to give it an icon and full screen.

To keep the screen on, plug the phone in. On Android, also turn on
**Settings › Developer options › Stay awake**, which keeps the screen on while
charging.

The web page shows all the numbers and one line about auto-continue. The list
of sessions and the auto-continue settings are in the Android app.

### The Android app

There is no ready-made download; you build the app yourself. That needs the
[Flutter SDK](https://docs.flutter.dev/get-started/install).

```sh
cd app
flutter build apk --release
```

Then install it one of two ways:

- **Over USB:** turn on USB debugging on the phone, plug it in, and run
  `flutter install`.
- **As a file:** copy `app/build/app/outputs/flutter-apk/app-release.apk` to the
  phone and open it. Android will ask you to allow installing apps from that
  source.

On first start the app searches your Wi-Fi for the PC and connects. If it finds
nothing, type the PC's address. While the app is open it runs full screen and
keeps the screen on. If the PC gets a new address, the app finds it again.

## What's on the screen

- **Session · 5 hours:** how much of the current 5-hour session is used, and
  when it resets. The crab eats the tokens as they come in.
- **This week:** the weekly limit, and when it resets.
- **Today:** tokens used today, per hour.
- **Now:** the last session Claude replied in, and how long ago. In the app,
  tap it for the list of sessions.

## Auto-continue after the 5-hour limit

When the 5-hour limit stops a Claude Code session, the session waits until you
come back and type "continue". CrabbyBurner does that for you: a minute after
the limit resets, it runs

```sh
claude -p --resume <session> continue
```

in that session's project folder, in the same permission mode the session was
using. This works for sessions started in a terminal and in the VS Code
extension. CrabbyBurner checks every 30 seconds, whether or not a phone is
watching.

### Choosing which sessions continue

In the app, tap the **Now** card to open **Sessions**. At the top, choose:

- **All** (the default): every session the limit cuts off continues, except the
  ones you switch off.
- **Picked:** only the sessions you switch on continue.
- **Off:** nothing continues by itself.

Below that, each session from the last 3 hours has its own switch. You can
switch a session on before the limit hits it.

The **Won't continue** card lists cut-off sessions that won't continue by
themselves, with the reason:

- it's switched off, or auto-continue is off;
- it was tried 3 times;
- the reset was more than 3 hours ago;
- it couldn't continue (the error is shown).

**Continue now** starts one of these straight away once its limit has reset.
The dashboard also tells you when a session won't continue, and an orange dot
appears on the Now card.

### The phone code

The server answers anyone on your Wi-Fi, so changing auto-continue needs the
six-digit code shown in the PC window. The app asks for it once and remembers
it. After five wrong codes, changes are locked for ten minutes.

### Good to know

- **The open window doesn't update.** The continued work runs in the
  background, so an open VS Code panel or terminal won't show it. To see what
  happened, reopen the session from its history (in a terminal: `claude
  --resume`). Don't type in the old panel at the same time; both would write to
  the same session.
- **It runs with nobody watching.** A session that ran in bypass-permissions
  mode continues without asking anything. In a mode that asks for approval,
  those requests are refused, because nobody is there to approve them.
- **The PC must stay on.** Keep the CrabbyBurner window open and don't let the
  PC go to sleep.
- **It uses your plan.** Each continue counts like any other message. Sessions
  stopped by the weekly limit are left alone.

## Settings

- **`~/.crabbyburner.json`** holds the auto-continue choice, the per-session
  switches and the phone code. Delete it to get a new code (the app will ask
  for it again); auto-continue goes back to **All**.
- **`PORT`** sets the port, 2722 by default. The app's Wi-Fi search only looks
  on 2722; on another port, type the address with the port in the app.
- **`HOST`** sets which address to listen on, `0.0.0.0` (all) by default.
  `127.0.0.1` keeps CrabbyBurner on the PC only.

To set one for a single start:

```sh
# PowerShell
$env:PORT=2723; npm start

# bash, zsh
PORT=2723 npm start
```

### Start with Windows

Press Win+R, type `shell:startup` and press Enter. In that folder, create a
shortcut with this target (use your own folder):

```
cmd /k "cd /d C:\path\to\crabbyburner && npm start"
```

## What it reads and what it sends

- **Session logs:** it reads Claude Code's session logs in
  `~/.claude/projects` to count tokens and to see which sessions the limit cut
  off. It keeps numbers, times, project folder names and session IDs from them,
  not what you and Claude wrote.
- **Your login:** it reads Claude Code's login from
  `~/.claude/.credentials.json` to ask Anthropic for your plan limits, the same
  numbers `/usage` shows in Claude Code. The token only goes to
  `api.anthropic.com`. It is never sent to the phone, stored or refreshed.
  Claude Code refreshes it itself.
- **Your network:** the page and its numbers are served on your local network
  without a login. Anyone on your Wi-Fi can see your usage and project names;
  only someone with the phone code can change auto-continue. Don't run it on
  public Wi-Fi, or set `HOST=127.0.0.1`.

## Troubleshooting

- **The phone can't connect.**
  - Check that phone and PC are on the same Wi-Fi. Guest networks often keep
    devices apart.
  - Allow Node.js on private networks in Windows Firewall.
  - Try the address in the phone's browser.
- **"Login expired."** Open Claude Code on the PC; it refreshes its login, and
  CrabbyBurner picks that up within a minute.
- **"No login found."** Sign in to Claude Code on the PC: run `claude` and use
  `/login`.
- **A session didn't continue.**
  - The CrabbyBurner window logs every continue, and why one failed.
  - The app's Sessions screen shows the reason too.
- **"Port 2722 is taken."** Start it on another port: `PORT=2723 npm start`.

## Development

```sh
npm test               # server tests
cd app && flutter test # app tests
npm run icons          # redraw the web and Android icons from the crab sprite
```

The server is in `src/`, the web page in `public/`, and the Android app in
`app/`. The font is Schibsted Grotesk, under the SIL Open Font License
(`public/fonts/OFL.txt`).
