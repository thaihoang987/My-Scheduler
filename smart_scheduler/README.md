# My Scheduler

<a href="https://buymeacoffee.com/leon_bell" target="_blank"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20beer&emoji=%F0%9F%8D%BA&slug=leon_bell&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a beer" height="50"></a>
<a href="https://ko-fi.com/leonbell" target="_blank"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support me on Ko-fi" height="50"></a>
<a href="https://paypal.me/leonbell95" target="_blank"><img src="https://img.shields.io/badge/PayPal-Donate-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate with PayPal" height="50"></a>

🍺 [Buy me a beer](https://buymeacoffee.com/leon_bell) · ☕ [Ko-fi](https://ko-fi.com/leonbell) · 💙 [PayPal](https://paypal.me/leonbell95)

An iPhone-style timer and scheduler for Home Assistant devices — no YAML automations, no Helpers
created by hand for each device. Pick a device, pick a time, done.

- On → off time ranges, fixed times or sunrise/sunset ± offset, repeat days
- Entity-state conditions, device groups, custom names/icons, favorites
- Forced-on with auto-off, presence simulation while away, pause all schedules
- Auto-off after on: a device that stays on longer than N (from any source) is turned off, survives restarts
- Missed-run catch-up, device state verification, history log, backup/restore
- Schedules run in the add-on backend — they keep working with the browser closed
- Interface language (English / Vietnamese): **Settings → Appearance → Language**

All times follow the Home Assistant time zone (Settings → System → General). Missed-run handling is
set in the app under **Settings → Scheduler**. The add-on Configuration tab can normally be left blank.

> **Personal project.** Feature requests will be considered when reasonable and time allows.
