import runpy
from pathlib import Path


def test_release_channel_preserves_app_name_and_install_identity(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[3]
    script = runpy.run_path(str(root / ".github/scripts/set_channel.py"))
    apply = script["apply"]
    paths = {
        "CONFIG": root / "smart_scheduler/config.yaml",
        "REPOSITORY": root / "repository.yaml",
        "README": root / "README.md",
    }
    for key, source in paths.items():
        target = tmp_path / source.name
        target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        monkeypatch.setitem(apply.__globals__, key, target)

    apply("stable", "0.5.93")
    config = (tmp_path / "config.yaml").read_text(encoding="utf-8")
    repo = (tmp_path / "repository.yaml").read_text(encoding="utf-8")
    readme = (tmp_path / "README.md").read_text(encoding="utf-8")
    assert 'slug: "smart_scheduler"' in config
    assert 'image: "ghcr.io/thaihoang987/smart-scheduler"' in config
    assert "name: My Scheduler - Home Assistant App" in repo
    assert "https://github.com/thaihoang987/My-Scheduler" in repo
    assert "repository_url=https%3A%2F%2Fgithub.com%2Fthaihoang987%2FMy-addon-Scheduler" in readme
    assert "# My Scheduler — Home Assistant App" in readme
