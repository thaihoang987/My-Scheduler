# Changelog

## 0.5.79

- Add auto-off rules to device detail, with saved drag-and-drop ordering independent of Home. Changing devices also updates matching auto-off rules; the auto-off toggle remains on Home.
- Cancel stale state-verification retries after the Home Assistant health request if the schedule, settings, command order or range deadline changed.
- Improve missed range-OFF recovery, HA connection checks, solar range handling and one-shot scene/script behavior.
- Retry Home Assistant timezone synchronization when HA is not ready at startup.
- Keep the accepted safety catch-up OFF behavior and existing mixed fixed/solar overnight selection policy.

## 0.5.78

- Fix: an overnight time range that does not repeat every day (e.g. Monday only, 22:00 → 02:00)
  now turns off the next morning. Before, the OFF run used the same repeat days as the ON run, so it
  fired before the ON time and the device stayed on until the next week. The OFF run's repeat days
  (and date range) now follow the ON run, shifted by one day for overnight ranges. Applies to every
  device type; existing schedules and restored backups are fixed automatically. Daily ranges are unchanged.

## 0.5.77

- Schedule list on the device page shows a short condition chip on schedules that use conditions
  (e.g. `Cool` for an AC schedule that only runs while cooling; another device's condition adds its
  name; several conditions show the first one + `+N`). Works for every device type.

## 0.5.76

- Home 24h view: an overnight time range is drawn as one 24h loop — while it runs, both halves
  (start → 24:00 and 00:00 → end) are highlighted.
- The 00:00 → end part now comes from the previous day's ON run, so ranges on the first/last day
  of a repeat pattern (e.g. Monday only) no longer show a wrong segment after midnight.

## 0.5.75

- Presence sample-plan dialog now uses a recorder-style timeline: one row per selected device,
  faint planned activations, gray projected rests, time-range controls and tap-to-inspect details.
- Sample plans stay read-only and do not fetch or pretend to be recorded Home Assistant history.
- Time-axis edge labels stay within the chart on narrow screens.

## 0.5.74

- Presence: shorter activations, longer rests, same-device cooldown, room alternation,
  dimmable-light brightness and a total device-on minute limit (not measured energy).
- Respect manually controlled devices and skip devices with enabled schedules or manual timers.
- At window end, trip expiry or explicit stop, send OFF to every selected device, including
  manually activated devices. Persist unconfirmed shutdowns and retry with backoff after outages.
- Add sunset start, optional last away date, per-device live status, an independent operation
  toggle, a Home stop button and a read-only sample-plan preview.
- Presence recorder chart shows actual on/off history in the same style as device detail,
  plus a faint upcoming activation. Recorded ON states are yellow; planned activations may be skipped.
- History tooltips now wrap and stay inside narrow phone layouts.

## 0.5.73

- List: long device names now wrap onto two lines. Arrange controls use a separate row so names
  remain visible on smaller phones.
- Group headers keep the device count on one line, even beside long group names.

## 0.5.72

- 24h chart: bars are white in the light theme; the dark theme uses its original color again.

## 0.5.71

- 24h chart: the bars are visible again in the light theme.

## 0.5.70

- On/off history card: the date and midnight labels on the time axis no longer flicker.

## 0.5.69

- 24h chart: group names are now bold with a device count, so they no longer look like a disabled device.

## 0.5.68

- 24h chart: long device names now wrap onto two lines in the name column instead of being cut off.

## 0.5.67

- Auto-off list: long device names now wrap onto a second line instead of being cut off after one line.

## 0.5.66

- New info button next to the version number: short introduction, GitHub link and donate buttons.
  The About page in Settings also links to GitHub.
- Device page: new Scheduling switch to turn all schedules of the device on or off. It is the same
  switch as the one on the device's Home card, so both always match.

## 0.5.65

- Fixed By time and 24h chart staying on an old time after leaving and reopening the app on a phone;
  countdowns also no longer fall behind after the app was in the background.
- By time now shows seconds, and the "Now" line ticks every second.

## 0.5.64

- Home view button now opens a menu with four views: Compact, List, **By time** and **24h chart**.
- By time: every on/off of the day for the whole house in time order, with a "Now" line, past runs faded
  and their result.
- 24h chart: one row per device with bars for its on-periods today, the running period highlighted and
  the most devices running at the same time.

## 0.5.63

- Home view button now switches between Compact and List only. Grid was removed because it looked
  almost the same as Compact; a saved Grid choice now shows as Compact.

## 0.5.62

- Home: new view button beside the theme button cycles Grid → Compact → List. List view shows one
  compact row per device with its next run and switch. Also selectable in Appearance settings.
- Devices whose entity no longer exists in Home Assistant now show a small, muted icon and
  "Not found in HA", with a hint on the device page to pick a new entity. Devices that are only
  offline are not marked.

## 0.5.61

- Home: tap the moon or sun icon beside the arrange button to switch between light and dark themes.
  The selection is saved and shared with Appearance settings.

## 0.5.60

- Smaller phones: device cards, editing controls, auto-off lists and form fields now fit narrow screens.
- Keep navigation inside the add-on frame and scroll long device details and schedule sheets within it.

## 0.5.59

- History card: the detail popup now closes when you tap anywhere outside it, tap the same segment
  again, press Esc or scroll the page.

## 0.5.58

- The add-on and the repository now show the new name **My Scheduler** in Home Assistant as well
  (0.5.57 still showed the old name in the add-on store).

## 0.5.57

- Smart Scheduler is now called **My Scheduler**. The repository moved to
  https://github.com/thaihoang987/My-addon-Scheduler – the old link keeps working, nothing to
  reinstall: your schedules, devices and settings stay as they are.

## 0.5.56

- Backup/restore now matches the current app: the file contains schedules (ranges, sunrise/sunset,
  auto-off, conditions), added devices with names/icons/groups, groups, presence simulation and all
  settings. Running state (presence devices currently on, pause, time zone) is no longer saved.
- Restoring replaces settings exactly as exported (missing ones go back to default).
- Restore asks for confirmation first, shows what was restored, and refuses files that are not a
  Smart Scheduler backup instead of wiping your schedules.
- History card: tapping a segment now shows a Home Assistant-style detail popup – device name, state,
  exact start and end time (with seconds) and the duration (HH:MM:SS).

## 0.5.55

- New on/off history card on the device page, between "Next run" and "Manual control": one bar per
  device (using your custom names), drag left/right to browse the past, pick 6h/24h/3d/7d, tap a
  segment to see when it turned on/off and for how long. Data comes from Home Assistant's Recorder
  and loads piece by piece while you drag.

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
