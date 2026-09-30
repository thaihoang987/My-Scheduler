# Smart Scheduler — Home Assistant (Hass.io) Add-on

![Home Assistant Add-on](https://img.shields.io/badge/Home%20Assistant-Add--on-41BDF5?style=for-the-badge&logo=homeassistant&logoColor=white)

<a href="https://buymeacoffee.com/leon_bell" target="_blank"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20beer&emoji=%F0%9F%8D%BA&slug=leon_bell&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a beer" height="50"></a>
<a href="https://ko-fi.com/leonbell" target="_blank"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support me on Ko-fi" height="50"></a>
<a href="https://paypal.me/leonbell95" target="_blank"><img src="https://img.shields.io/badge/PayPal-Donate-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate with PayPal" height="50"></a>

🍺 [Buy me a beer](https://buymeacoffee.com/leon_bell) · ☕ [Ko-fi](https://ko-fi.com/leonbell) · 💙 [PayPal](https://paypal.me/leonbell95)

> **This is a Home Assistant add-on** (Hass.io / Supervisor). It requires **Home Assistant OS** or
> **Home Assistant Supervised** — the add-on store is not available on Home Assistant Container or Core.

An iPhone-style timer and scheduler for Home Assistant devices — no YAML automations, no Helpers
created by hand for each device. Pick a device, pick a time, done. Schedules run in the add-on
backend, so they keep working with the browser closed.

## Installation

[![Open your Home Assistant instance and show the add add-on repository dialog with this repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fthaihoang987%2FSmart-Schedule)

Or manually: **Settings → Add-ons → Add-on Store → ⋮ → Repositories**, add

```
https://github.com/thaihoang987/Smart-Schedule
```

then install **Smart Scheduler**, start it and open it from the sidebar.

Updates are prebuilt images (amd64 / aarch64), so updating only downloads — nothing is compiled on
your Home Assistant machine.

## Add-ons in this repository

### [Smart Scheduler](smart_scheduler/README.md)

![Supports amd64 Architecture](https://img.shields.io/badge/amd64-yes-green.svg)
![Supports aarch64 Architecture](https://img.shields.io/badge/aarch64-yes-green.svg)

On → off time ranges, sunrise/sunset triggers, conditions, groups, forced-on timers, presence
simulation, missed-run catch-up, state verification, history and backup. English and Vietnamese UI.

> **Personal project.** Feature requests will be considered when reasonable and time allows.
> Issues: https://github.com/thaihoang987/Smart-Schedule/issues

## License

MIT — see [LICENSE](LICENSE).
