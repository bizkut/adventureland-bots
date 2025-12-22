# Adventure.land Bots

This is the code I use to run my bots in [AdventureLand](https://adventure.land). I use an NPM package I also made called [ALClient](https://github.com/earthiverse/alclient).

Take a look, feel free to modify it to suit your own needs, or for inspiration.

If you want to contribute to [ALClient](https://github.com/earthiverse/alclient) development, please do!

There's also a folder called `vanilla_scripts`. Those scripts are meant to be run in the main game, do not attempt to run them with ALClient.

## Docker Usage

You can run the bots using Docker for a consistent environment.

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Getting Started

1. **Prepare credentials**:
   Copy `credentials.json.sample` to `credentials.json` and fill in your details.
   ```bash
   cp credentials.json.sample credentials.json
   ```

2. **Run with Docker Compose**:
   ```bash
   docker-compose up --build
   ```

The bot will be accessible on port `80` (Express server) and port `8080` (GUI strategy).

---

## Dashboard

A real-time web dashboard for monitoring your bots at `http://localhost/dashboard`.

### Features

- **Live Stats**: Total gold, bank gold, gold/hour, XP/hour, kills, deaths, items looted, uptime
- **Character Cards**: Real-time HP/MP/XP bars, level, class icons, animated sprites
- **Tabbed Activity View**: 
  - 📜 **Activity Log**: Kills, deaths, level-ups, party changes, server hops, trades, upgrades
  - 💰 **Gold Timeline**: Track gold changes over time with correlated activities
  - ⭐ **XP Log**: Track cumulative XP gains with associated kill events
- **Boss Tracker**: Live boss locations with HP bars
- **Respawn Timers**: Countdown to boss respawns
- **Error Log**: Filtered view of errors for debugging
- **Expandable Event Details**: Click any event with ▶ to see details (damage, gold earned, party members, etc.)
- **Activity Filters**: Filter by event type (Kills, Deaths, Level, Party, Upgrade, Server, Trade, Sell)
- **Load More / Search Deeper**: Load historical data from MongoDB with infinite scroll or button click
- **Real-time Updates**: All logs update live via WebSocket

### Activity Events Tracked

| Event | Icon | Description | Expandable Details |
|-------|------|-------------|-------------------|
| Kill | ⚔️ | Monster kills | Monster type, damage dealt |
| Death | 💀 | Character deaths | Cause, map, position (x, y) |
| Level Up | 🎉 | Level progression | Previous → new level |
| Party | 👥 | Party join/leave | Full member list |
| Loot | 🎒 | Items collected | - |
| Banking | 🏦 | Bank deposits/withdrawals | - |
| Buy | 🛒 | Purchases from NPCs | - |
| Sell | 💵 | Sales to NPCs | Item name, gold earned |
| Upgrade | 🔧 | Upgrade/compound results | Success/fail result |
| Server | 🌐 | Server hops | From → to server |
| Instance | 🚪 | Dungeon/instance entries | - |
| Trade | 🤝 | Trade transactions | Trade details |
| Error | ❌ | Errors and warnings | - |

### Persistent Storage

Dashboard data is stored in MongoDB:
- `dashboard_events`: Activity logs (7 day retention)
- `dashboard_stats`: Cumulative stats (kills, deaths, items)
- `gold_history`: Gold snapshots with deltas and activity correlation
- `xp_history`: XP snapshots with cumulative tracking across all levels

---

## Sprite Sheet Reference

Adventure Land characters are rendered by compositing multiple sprite layers. This section documents the sprite sheet structure based on the server source code.

> **Source**: `adventureland/design/cosmetics.py`, `sprites.py`, `precomputed.py`

### Sprite Directories

All cosmetic sprites are served from `http://localhost:8080/images/cosmetics/`:

| Directory | Contents | Example Files | Dimensions (HxW) |
|-----------|----------|---------------|------------------|
| `skins/` | Base body skins (no head) | `mskin1.png`, `sskin1.png`, `lskin1.png` | 288×324 |
| `armors/` | Armor/clothing sprites | `marmor12.png`, `mbody5.png` | 288×324 |
| `makeup/` | Head/face skins | `makeup1.png`, `fmakeup.png` | 120×1134, 120×351 |
| `hairdo/` | Hairstyle sprites | `hairdo1.png` - `hairdo6.png` | 120×675 |
| `hats/` | Hat accessories | `hats1.png` - `hats4.png` | 120×675 |

### Body/Armor Sprite Layout (288×324)

- **8 characters per sheet**: a-d (row 1), e-h (row 2)
- **12 frames per character**: 3 cols × 4 directions (down, left, right, up)
- **Frame size**: 27×36 pixels
- **Character block**: 81×144 pixels

```
Character Grid (324x288):
┌────────┬────────┬────────┬────────┐
│   a    │   b    │   c    │   d    │  row 0 (y=0-143)
│ 81×144 │ 81×144 │ 81×144 │ 81×144 │  
├────────┼────────┼────────┼────────┤
│   e    │   f    │   g    │   h    │  row 1 (y=144-287)
│ 81×144 │ 81×144 │ 81×144 │ 81×144 │
└────────┴────────┴────────┴────────┘

Per-character animation frames (81×144):
┌───┬───┬───┐
│ 0 │ 1 │ 2 │ ← down (y=0-35)
├───┼───┼───┤
│ 0 │ 1 │ 2 │ ← left (y=36-71)
├───┼───┼───┤
│ 0 │ 1 │ 2 │ ← right (y=72-107)
├───┼───┼───┤
│ 0 │ 1 │ 2 │ ← up (y=108-143)
└───┴───┴───┘
```

### Head/Face (Makeup) Sprite Layout

**makeup1.png** (1134×120):
- 42 columns × 4 directions = width 1134 (27px × 42 heads)
- Height: 120 (30px × 4 directions)
- Frame size: 27×30 pixels

### Character Size Prefixes

| Prefix | Size | Body Skin | Armor Example |
|--------|------|-----------|---------------|
| `m` | Medium (normal) | `mskin1.png` | `marmor12.png` |
| `s` | Small | `sskin1.png` | `sarmor1.png` |
| `l` | Large | `lskin1.png` | `larmor1.png` |

### Head-to-Body Skin Mapping

From `cosmetics.py`, head IDs map to body positions:

```python
"head": {  # [small, normal, large, dh]
    "makeup117": ["sskin1a", "mskin1a", "lskin1a"],  # uses position 'a'
    "makeup100": ["sskin1e", "mskin1e", "lskin1d"],  # uses position 'e' 
    "fmakeup01": ["sskin1a", "mskin1a", "lskin1a"],  # female, position 'a'
    ...
}
```

### Layer Order (z-index)

Characters are rendered bottom-to-top:

1. **Base Skin** (`skins/`) - body color foundation
2. **Armor/Body** (`armors/`) - clothing/equipment
3. **Head/Face** (`makeup/`) - head with skin color
4. **Hair** (`hairdo/`) - hairstyle
5. **Hat** (`hats/`) - headwear accessory

### Character Data (cx field)

The `cx` object from `alclient` contains cosmetic identifiers:

```json
{
  "skin": "mbody5f",      // Armor/body (includes position letter a-h)
  "cx": {
    "head": "fmakeup01",  // Head skin (maps to body position via cosmetics.head)
    "hair": "hairdo520",  // Hairstyle
    "hat": null           // Hat (optional)
  }
}
```

### Hair Sprite Calculation

**Hair sheets** (`hairdo1.png` - `hairdo6.png`, each 675×120):
- 25 styles per sheet × 4 directions
- Frame size: 27×30 pixels
- Naming: `hairdo520` = sheet 5, style index 20

```javascript
// Example: hairdo520 → sheet 5, style 20
const hairNum = 520;
const sheetNum = Math.floor(hairNum / 100);  // 5
const styleIndex = hairNum % 100;             // 20
const frameX = styleIndex * 27;               // 540px
```

### Hooded Body Sprites

Some body/armor sprites (like `mbody5`) include a hood or head covering built into the clothing layer. Characters wearing these sprites may not have a separate `cx.hair` value - the "hair" is part of the body sprite itself.

