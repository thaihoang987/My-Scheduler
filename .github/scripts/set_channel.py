#!/usr/bin/env python3
"""Switch the app between the stable and test channel.

  set_channel.py version              -> print the base version (without -test.N)
  set_channel.py apply test <version> -> test channel (own slug/name/image, so it
                                         installs side by side with stable)
  set_channel.py apply stable         -> stable channel (prebuilt image)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "smart_scheduler" / "config.yaml"
REPOSITORY = ROOT / "repository.yaml"
README = ROOT / "README.md"
OWNER = "thaihoang987"

CHANNELS = {
    "stable": {
        "name": "My Scheduler",
        "slug": "smart_scheduler",
        "panel_title": "My Scheduler",
        "image": f"ghcr.io/{OWNER}/smart-scheduler",
        "repo_name": "My Scheduler - Home Assistant App",
        "desc_prefix": "",
    },
    "test": {
        "name": "My Scheduler (Test)",
        "slug": "smart_scheduler_test",
        "panel_title": "My Scheduler Test",
        "image": f"ghcr.io/{OWNER}/smart-scheduler-test",
        "repo_name": "My Scheduler - TEST channel",
        "desc_prefix": "[TEST build - may be unstable] ",
    },
}
TEST_BANNER = (
    "> ⚠️ **TEST channel** — pre-release builds for testing. Use the `main` branch for the stable app.\n\n"
)


def base_version(text: str) -> str:
    m = re.search(r'^version:\s*"?([^"\n]+)"?', text, flags=re.M)
    if not m:
        sys.exit("version not found in config.yaml")
    return re.sub(r"-test\.\d+$", "", m.group(1).strip())


def set_key(text: str, key: str, value: str) -> str:
    line = f'{key}: "{value}"'
    if re.search(rf"^{key}:", text, flags=re.M):
        return re.sub(rf"^{key}:.*$", line, text, count=1, flags=re.M)
    # new key right after version:
    return re.sub(r"^(version:.*)$", rf"\1\n{line}", text, count=1, flags=re.M)


def apply(channel: str, version: str | None) -> None:
    ch = CHANNELS[channel]
    text = CONFIG.read_text(encoding="utf-8")
    version = version or base_version(text)
    for key in ("name", "slug", "panel_title", "image"):
        text = set_key(text, key, ch[key])
    text = set_key(text, "version", version)
    desc = re.search(r'^description:\s*"(.*)"\s*$', text, flags=re.M)
    if desc:
        body = desc.group(1)
        for c in CHANNELS.values():
            if c["desc_prefix"] and body.startswith(c["desc_prefix"]):
                body = body[len(c["desc_prefix"]):]
        text = set_key(text, "description", ch["desc_prefix"] + body)
    CONFIG.write_text(text, encoding="utf-8", newline="\n")

    repo = REPOSITORY.read_text(encoding="utf-8")
    repo = re.sub(r"^name:.*$", f"name: {ch['repo_name']}", repo, count=1, flags=re.M)
    REPOSITORY.write_text(repo, encoding="utf-8", newline="\n")

    readme = README.read_text(encoding="utf-8").replace(TEST_BANNER, "")
    if channel == "test":
        head, _, rest = readme.partition("\n\n")
        readme = f"{head}\n\n{TEST_BANNER}{rest}"
    README.write_text(readme, encoding="utf-8", newline="\n")
    print(f"{channel}: {ch['slug']} {version} -> {ch['image']}")


def main() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == "version":
        print(base_version(CONFIG.read_text(encoding="utf-8")))
    elif len(sys.argv) >= 3 and sys.argv[1] == "apply" and sys.argv[2] in CHANNELS:
        apply(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
