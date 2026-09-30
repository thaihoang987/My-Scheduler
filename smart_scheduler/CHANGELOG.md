# Changelog

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
