# Immersive Game

**[中文版](README.zh-TW.md)** | English

Multiplayer interactive game framework designed for immersive spaces. Players use their phones as private interfaces (identity cards, role cards, buttons), while a large screen serves as the shared visual scene controlled by a host/GM.

```
                        ┌─────────────────┐
                        │   Large Screen  │
                        │   (display)     │
                        └────────▲────────┘
                                 │
   📱 Phone ──┐              Socket.IO
   📱 Phone ──┤  ←──────────►  Server  ←─────────► 🎛 Host Console
   📱 Phone ──┤                                    (host UI)
   📱 Phone ──┘
```

No coding required — use the built-in **Editor** to create game modules (card content, stages, progression rules, timers, voting settings, loop logic), save, and play.

---

## Quick start

```bash
npm install
npm start                                 # localhost:3000
npm run start:lan                         # Use local en0 IP for LAN (for mobile QR scanning)
npm run dev                               # nodemon
```

After starting, you'll see:

```
🎮 Immersive Game Server
   Local   → http://localhost:3000
   Mobile  → http://localhost:3000/mobile
   Display → http://localhost:3000/display
   Host    → http://localhost:3000/host
   Editor  → http://localhost:3000/editor
   Decks   → http://localhost:3000/decks
```

| URL | Role | Device |
|-----|------|------|
| `/host` | Host — create rooms, select modules, advance stages, kick players | Desktop/Tablet |
| `/mobile` | Player — view private cards, play cards, confirm identity, vote | Phone |
| `/display` | Large screen public info — progress, voting results, visuals | Projector/Web Render TD |
| `/editor` | Designer — create/modify/delete game modules, supports card selection | Desktop |
| `/decks` | Designer — manage shared card decks (card content + image upload) | Desktop |

---

## Game Flow

1. **Host** opens `/host` → selects module → "Create Room" to get room number + QR code
2. **Players** scan QR code with phones to enter `/mobile?room=ABCDEF`, enter names
3. **Large screen** opens `/display?room=ABCDEF`
4. **Host** confirms everyone is ready → starts game
5. Game runs through module stages
6. After ending, host can restart or close room

Players get 30-second grace window for reconnection. Upon reconnecting, hand cards, identities, voting status, and current stage are automatically restored.

---

## Key Features

### 🎴 Custom Deck Combination
When creating game modules in the editor, you can select specific cards from global decks to create custom decks:

**How to use:**
1. Select a module in the editor
2. Switch to "Decks" tab
3. Add a new deck or edit existing deck
4. Select a global deck from dropdown
5. Expand the deck to see all cards
6. Check desired cards and set quantities in the right input field
7. Use "Select All" to quickly select all cards, or "Clear" to cancel selection
8. Save module — game will only use selected cards with specified quantities

**Use cases:**
- Select specific characters from large character decks for beginner games
- Adjust action card strength distribution (reduce high-value cards)
- Create themed variants (e.g., magic-only cards)
- Test with small decks (faster gameplay)

**Technical details:**
- Card selection info stored in module manifest's `selectedCards` field
- Format: `{ "cardId": count, ... }`
- Uses full deck when no cards selected
- Automatically clears selected cards when switching global decks

---

## Framework Core Concepts

### 1. Module (Game)
A `manifest.json` is a complete game, located in `server/modules/<id>/`.

```jsonc
{
  "id": "card-battle",
  "name": "Card Battle",
  "minPlayers": 2,
  "maxPlayers": 8,
  "version": "2.0.0",
  "decks":  [ /* decks */ ],
  "stages": [ /* stage flow */ ]
}
```

### 2. Stages

Stages are the skeleton of game flow. Currently supported types:

| Type | Behavior |
|------|------|
| `identity_draw` | Draw cards from specified deck, privately deal to each player as identity/role |
| `card_play` | Multi-round card play → reveal → settle → next round |
| `vote` | Public or anonymous voting, supports countdown, single/multi-select, vote changing |
| `intermission` | Pause wait, only shows description text, triggers no game logic |
| `input` | Transform mobile into real-time game controller, button signals sent to display canvas immediately |
| `loop` | Loop through a set of child stages N times (for multi-round voting, multi-round story, etc.) |
| `result` | Calculate final rankings, broadcast `game_ended` |

#### Advance Conditions

```jsonc
"advance": {
  "trigger": "all_played",   // see table below
  "duration": 5,             // for timer/auto (seconds)
  "fallback": "host"         // any trigger can add this, host keeps force advance button
}
```

| Trigger | Meaning |
|---------|------|
| `host` | Host clicks button (default) |
| `all_played` | Auto after all played |
| `all_confirmed` | Auto after all confirmed |
| `vote_ended` | Auto after voting results ready |
| `auto` | Auto after fixed delay (no countdown shown) |
| `timer` | Auto after countdown ends, all three ends see seconds |
| `identity_timer` | Countdown after all confirmed |
| `auto_next` | Immediately advance to next stage after reveal |
| `round_timer` | Countdown to next stage after reveal |
| `host_reveal` | Host manual reveal |
| `play_timer` | Countdown reveal after all played |
| `all_submitted` | Auto after all submitted |
| `auto_restart` | Immediately restart game |
| `restart_timer` | Restart after countdown |

`fallback: 'host'` means even with auto-advance, host keeps force advance button.

#### Vote Stage Config

```jsonc
{
  "type": "vote",
  "name": "Elimination Vote",
  "voteConfig": {
    "title": "Please vote to eliminate a player",
    "target": "players",          // players | options
    "options": [],                // for target=options
    "countdownSeconds": 30,       // 0 = no timer
    "anonymous": false,           // anonymous voting
    "allowSelfVote": false,
    "multiSelect": false,
    "maxSelections": 1,
    "canChangeVote": true,
    "revealDelay": 2              // result announcement delay (seconds)
  },
  "advance": { "trigger": "vote_ended", "fallback": "host" }
}
```

#### Input Stage Config

```jsonc
{
  "type": "input",
  "name": "Multiplayer Controller",
  "inputConfig": {
    "layout": "dpad-2btn",     // see table below
    "buttonLabels": {          // custom labels for each button (optional)
      "btn1": "A",
      "btn2": "B"
    },
    "gameCode": "..."          // display canvas game logic JS (optional)
  },
  "advance": { "trigger": "host" }
}
```

**Controller Layouts (`layout`)**:

| Value | Appearance |
|----|------|
| `pad-8` | 2×4 eight-button grid (btn1–btn8) |
| `pad-4` | 2×2 four-button grid (btn1–btn4) |
| `pad-2` | Two large buttons left-right (btn1, btn2) |
| `dpad-2btn` | Left D-pad (up/down/left/right) + right A/B buttons |
| `dpad-dpad` | Dual D-pad (left up/down/left/right, right up2/down2/left2/right2) |

Every time a player presses or releases a button, server immediately broadcasts to display as `player_input` event:

```json
{ "playerId": "p1", "playerName": "Alice", "key": "btn1", "state": "down" }
```

**`gameCode` — Custom Display Game**

`gameCode` is JavaScript that runs on display side, can use `GameAPI` object to receive player input and customize display:

```js
// GameAPI provides:
// GameAPI.canvas   — HTMLCanvasElement (fullscreen)
// GameAPI.ctx      — CanvasRenderingContext2D
// GameAPI.players  — Map<playerId, { name, color, inputs: Set<key> }>
// GameAPI.onInput(fn)  — called on each button event fn(playerId, key, state, player)
// GameAPI.update(fn)   — called each animation frame, replaces default visualization

GameAPI.onInput((playerId, key, state, p) => {
  // real-time response to buttons
});
GameAPI.update(ts => {
  const ctx = GameAPI.ctx;
  // custom drawing logic
});
```

If not provided, display shows default visualization: each player has colored area, pressed buttons shown as glowing circles.

#### Loop Stage Config

```jsonc
{
  "type": "loop",
  "name": "Multi-round Voting",
  "loopConfig": { "iterations": 3 },
  "childStages": [
    { "type": "intermission", "name": "Instructions", "advance": { "trigger": "host" } },
    { "type": "vote", "name": "Vote", "voteConfig": { ... }, "advance": { "trigger": "vote_ended" } }
  ]
}
```

### 3. Decks
Two sources:

**Embedded** (module自带):
```jsonc
{ "id": "action", "name": "Action Deck", "type": "action",
  "drawCount": 5, "allowDuplicate": true, "enabled": true,
  "cards": [
    { "id": "c1", "name": "Fireball", "value": 9, "description": "Strong attack" }
  ]
}
```

**Reference global** (shared across modules):
```jsonc
{
  "ref": "fantasy-roles",
  "id": "my-custom-deck",
  "name": "Custom Fantasy Deck",
  "drawCount": 3,
  "allowDuplicate": false,
  "selectedCards": {
    "warrior": 2,
    "mage": 1,
    "rogue": 1
  }
}
```

Global decks stored in `server/decks/*.json`, managed via `/decks` UI (includes card image upload).

**Select specific cards from global decks** (new feature):
- After referencing global deck in editor, can select desired cards from it
- Each card can have independent quantity setting
- Use "Select All" or "Clear" buttons for quick operations
- Uses full deck if no cards selected
- Card selection saved in module's `selectedCards` field

### 4. Engine
All modules share `server/core/BaseModule.js` universal engine. For custom logic, place `server.js` in module directory inheriting from `BaseModule`:

```js
const BaseModule = require('../../core/BaseModule');
class MyGame extends BaseModule {
  async onPlayerAction(playerId, action, data, session) {
    // custom behavior
  }
}
module.exports = MyGame;
```

---

## Reconnection Recovery

When players disconnect and reconnect, server automatically pushes complete state restoration packet:

| Event | Content |
|------|------|
| `identity_assigned` | Identity card (includes `alreadyConfirmed` flag, confirmed ones won't show overlay) |
| `cards_drawn` | Current hand cards |
| `stage_started` | Current stage (includes loop context) |
| `vote_started` | If in voting, resend complete voting info |
| `vote_countdown` | Voting remaining seconds |
| `vote_cast` | If player voted, restore "voted" status |
| `players_eliminated` | If player eliminated |

---

## Directory Structure

```
immersive-game/
├── README.md
├── server/
│   ├── index.js                    ← Express + Socket.IO main entry
│   ├── core/
│   │   ├── BaseModule.js           ← Universal game engine (stage traversal, vote, loop, reconnect)
│   │   ├── ModuleLoader.js         ← Scan/load manifests
│   │   ├── DeckManager.js          ← Global deck CRUD
│   │   ├── GameSession.js          ← Room state machine
│   │   └── PlayerManager.js        ← Player management
│   ├── api/
│   │   └── decks.js                ← /api/decks REST routes
│   ├── modules/
│   │   ├── card-battle/            ← Built-in example: Card battle
│   │   ├── multi-stage-test/       ← Test: Multi-stage flow
│   │   ├── public-vote-test/       ← Test: Public voting
│   │   └── vote-demo/             ← Test: Voting demo
│   └── decks/                      ← Global deck JSON
├── client/
│   ├── mobile/game.html            ← Player phone interface
│   ├── host/index.html             ← Host console
│   ├── display/index.html          ← Large screen public interface
│   ├── editor/index.html           ← Module editor
│   ├── decks/                      ← Global deck management
│   └── shared/socket.js            ← Shared socket wrapper
└── public/uploads/                 ← Card images (not in git)
```

---

## Built-in Modules

### `card-battle` — Card Battle
2–8 players, 5 cards each, play cards for set rounds comparing values, highest value gets 1 point, highest total score wins. Supports identity draw, refill mode settings.

### `input-test` — Controller Test
1–8 players, single `input` stage with `pad-4` layout, to verify controller input and display reception works correctly.

---

## Development

### LAN Mode (mobile real-device testing)
```bash
npm run start:lan
```
Auto-grabs `en0` IP, QR code lets same-WiFi phones connect directly.

### Editor Usage Guide
`/editor` provides visual interface to design game modules without manual JSON editing:

1. **Basic Parameters** tab: Set module name, description, player limits, version, etc.
2. **Decks** tab:
   - Add deck and reference global deck
   - Select specific cards from referenced deck
   - Set quantity for each card
   - Adjust default draw count and duplicate allowance
3. **Stages** tab:
   - Add different stage types (identity draw, card play, voting, pause, loop, result)
   - Set stage advance conditions (manual, auto, countdown)
   - Configure voting parameters (anonymous, self-vote, multi-select)
   - Set card play round refill mode and round count
4. **Advanced** tab:
   - Direct edit manifest JSON and fieldConfig structure descriptions
   - **Edit server.js**: Inherit BaseModule to implement custom game logic
     - Click "➕ Add server.js" or "📝 Edit server.js" button
     - Editor auto-validates syntax and basic structure
     - Must inherit BaseModule and export module class
     - Example:
       ```javascript
       const BaseModule = require('../../core/BaseModule');

       class MyModule extends BaseModule {
         async onPlayerAction(playerId, action, data, session) {
           // custom behavior
         }
       }

       module.exports = MyModule;
       ```
     - Can delete server.js to use default BaseModule behavior

**Keyboard shortcuts**:
- `⌘S` / `Ctrl+S`: Save current module
- `⌘Z` / `Ctrl+Z`: Undo last change

### TouchDesigner / Web Render TOP
Feed `/display?room=ABCDEF` to Web Render TOP. Display continuously receives `state_update`.

### Environment Variables
| Variable | Description |
|----------|-------------|
| `PORT` | Service port (default 3000) |
| `HOST` | IP embedded in QR code (default uses request Host header) |

---

## License
TBD
