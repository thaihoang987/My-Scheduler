# My Scheduler — Documentation

Enjoying it? 🍺 [Buy me a beer](https://buymeacoffee.com/leon_bell) · ☕ [Ko-fi](https://ko-fi.com/leonbell) · 💙 [PayPal](https://paypal.me/leonbell95)

## Getting started

1. Start the add-on and enable **Show in sidebar**.
2. Open **My Scheduler** from the sidebar.
3. Go to **Settings → Devices** and add the devices you want to schedule. This step is for the
   person who manages the add-on: pick devices from Home Assistant and give them friendly names so
   family members can easily find and use them. **Only devices added here can be added to the
   Home page.**
4. Tap **+** on the Home page, pick a device and create a schedule: a single time, or an on → off
   time range.

The add-on talks to Home Assistant through the Supervisor, so no token or URL is needed.

## Schedules

- **Trigger**: a fixed time (to the second), or sunrise / sunset with a ± minute offset.
- **Time range**: turn on at the start and off at the end. Disabling a schedule or pausing all
  schedules during an active range turns the device off immediately.
- **Repeat days** and an optional **active date range**.
- **Conditions**: only run when other entities are in a given state (or above/below a number).
- **Actions**: on / off / toggle, plus climate mode and temperature, light brightness, cover
  position and fan speed.

## Other features

- **Forced on**: turn a device on now with an automatic off timer; survives add-on restarts.
- **Auto-off after on**: + → "Auto-off after on", pick a device and a duration. Whenever it turns on (dashboard, wall switch, automation, another schedule) it is turned off after that duration. The on-time is stored, so a Home Assistant restart or backup does not reset the countdown; if it expired while offline, it turns off as soon as the add-on is back.
- **Presence simulation**: randomly switch selected devices while you are away.
- **Groups, custom names, icons, favorites** to organize the Home page.
- **Missed runs**: skip, or run once after the add-on restarts.
- **State verification**: re-check the device 30 s after a run and retry once if needed.
- **History** of every execution, and **backup / restore** of all data.

## Settings

Everything is configured inside the app under **Settings**:

- **Appearance → Language**: English (default) or Vietnamese.
- **Scheduler**: missed-run policy, pause. The time zone always follows Home Assistant (shown read-only).

## Add-on configuration

Normally leave both options empty.

- **ha_token**: fallback Long-Lived Access Token, only if the Supervisor connection is unavailable.
- **ha_base_url**: fallback Core API URL, only together with `ha_token`.

## Support

This is a personal project. Issues and requests:
https://github.com/thaihoang987/My-addon-Scheduler/issues — they will be considered when reasonable
and time allows.
