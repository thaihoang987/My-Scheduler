# Changelog

## 0.5.54

- The time zone always follows Home Assistant (Settings → System → General) for every schedule,
  sunrise/sunset, pause, presence simulation and every time shown in the app. The separate time zone
  picker was removed (two places to choose a zone only caused shifted times). A zone chosen in an older
  version is dropped automatically on startup and noted in the Log.
- Tests no longer skip time-sensitive cases around midnight.

## 0.5.53

- Time zone now comes straight from Home Assistant (Settings → System → General) unless you pick a
  different one in the app. A different zone replaces the HA zone (it is never added on top); the
  mismatch is noted in the Log.
- Fixed: card times, sunrise/sunset hints, the Log, pause and presence times were shown in the
  browser/phone time zone. Everything now uses the app time zone, so a phone set to another zone no
  longer shows shifted times.
- Faster, on-time runs: many schedules due at the same second no longer queue up (each Home Assistant
  call used to rebuild its SSL context, ~0.2 s each). Auto-off now turns off exactly on time instead of
  up to 5 s late, and bursts of updates reload the page data once.
- Backups no longer freeze the default time zone when restored.

## 0.5.52

- Fixed: when a time range turned a device on, its card could stay at "Due now" without the countdown
  bar until the page was reloaded (the page refreshed in the same second the run happened and got the
  run it had just done as the "next run"). The card now switches to on + countdown immediately and hides
  the bar when the range ends – no page reload.
- The page re-syncs schedules and countdowns after the connection drops and comes back, and when you
  return to the tab/app. Auto-off rows update the device on/off state together with the countdown.
- Add devices: devices already in your list are marked "✓ Added" and can't be picked again.

## 0.5.51

- Much faster with large Home Assistant setups (tested with 10,000 entities): the area/device registry
  is cached instead of re-downloaded on every refresh, the Home page only polls the devices you added,
  and the device list is serialized much faster.
- Device picker: tap a row to select it (it turns yellow with a check mark) instead of a small checkbox.
  Search stays instant and always searches every entity; the list shows 100 rows and loads 100 more as
  you scroll.
- Removing or favoriting a device in Settings → Devices updates instantly.
- Time ranges: the OFF point can now also be sunrise/sunset ± offset (e.g. on at sunset, off at sunrise),
  each point has its own Time / Sunrise / Sunset chips, and a ⇅ button swaps the ON and OFF points.

## 0.5.50

- After adding devices in Settings → Devices, the Edit name/icon sheet opens right away. When several
  devices were added at once, ◀ ▶ arrows switch between them (changes are saved when you switch) and
  the Save button becomes "Save & next".
- Devices of different types can be added together in Settings → Devices (the same-type limit only
  applies when building a schedule).
- Popups no longer close by accident when you press inside them and release outside (e.g. dragging a
  wheel picker or selecting text); they close only when both press and release happen outside.

## 0.5.49

- Larger text in Settings, on both phones and desktop: device names and entity IDs in Settings → Devices
  (were 13/10 px, now 16/13 px), bigger action buttons and icons, and slightly larger menu, hint, status
  and log text.
- Icons in Settings scaled up to match: menu icons (32 → 40 px tiles), back/chevron arrows, device icons,
  group, backup and device picker icons.

## 0.5.48

- Maintenance release (no functional changes since 0.5.47).

## 0.5.47

- Auto-off rows are laid out as a grid (about a quarter of the width on desktop, full width on phones).
- Every group on Home can be collapsed/expanded by tapping its title; the state is remembered on each device.
- In Arrange mode (pencil) groups get ▲/▼ buttons: move the Auto-off block anywhere between the other
  groups, and reorder your own groups right from Home.

## 0.5.46

- Auto-off rows on Home can be reordered: tap the pencil (Arrange) and drag the handle.

## 0.5.45

- Auto-off timers are now shown together as one list on Home (icon, name, countdown bar, duration,
  on/off switch) instead of one card per device. Tap a row to edit or delete it.
- A new auto-off timer starts with the duration of the one you created or edited most recently.

## 0.5.44

- New "Auto-off after on" timer type: pick a device and a duration (e.g. 30 min for garden watering).
  Whenever the device turns on — from the dashboard, a wall switch, an automation or another schedule —
  it is turned off after that duration. Shown as a card on Home with a countdown bar.
- The on-time is saved, so restarting Home Assistant or the host (e.g. a nightly VM backup) keeps the
  original countdown; if the time ran out while offline, the device is turned off right after startup.
- A "Forced on" with its own off timer takes precedence over auto-off for that device.

## 0.5.43

- Fixed a false "Missed run" when a schedule is created or edited after its time already passed today
  (e.g. creating a 23:30 → 02:30 range in the evening flagged the 02:30 off step as missed).
- Skipped/failed runs are now shown only in Settings → Log, no longer as a banner on the Home page.
- Log: the status text no longer overflows the row.

## 0.5.42

- Added Ko-fi and PayPal support links (About page, README, add-on description).

## 0.5.41

- First public release.
- iPhone-style schedules: fixed time, sunrise/sunset ± offset, on → off time ranges, repeat days,
  active date ranges, entity-state conditions.
- Climate, light, cover and fan actions; forced-on with auto-off; presence simulation.
- Groups, custom names/icons, favorites; missed-run handling; state verification; history;
  backup/restore.
- English (default) and Vietnamese interface.
