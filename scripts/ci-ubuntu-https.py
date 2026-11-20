#!/usr/bin/env python3
"""Use official HTTPS mirrors for Ubuntu's existing CI package sources."""

import argparse
from pathlib import Path
import re


UBUNTU_HTTP = re.compile(
    r"(?<!\S)http://(?P<host>security\.ubuntu\.com|"
    r"(?:[a-z0-9-]+\.)*archive\.ubuntu\.com)/ubuntu(?=/|\s|$)"
)


def use_https(source: str) -> str:
    def replace(match: re.Match[str]) -> str:
        # Regional/EC2 HTTP mirrors can stall before APT reaches the working
        # HTTPS archive. Retain the security archive and every suite/key option.
        host = (
            "security.ubuntu.com"
            if match["host"] == "security.ubuntu.com"
            else "archive.ubuntu.com"
        )
        return f"https://{host}/ubuntu"

    return "".join(
        line if line.lstrip().startswith("#") else UBUNTU_HTTP.sub(replace, line)
        for line in source.splitlines(keepends=True)
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apt-root", type=Path, default=Path("/etc/apt"))
    apt_root = parser.parse_args().apt_root
    # Hosted runners also use mirror+file:/etc/apt/apt-mirrors.txt. Its URI
    # entries have optional tab-separated priorities which stay unchanged.
    sources = [apt_root / "sources.list", apt_root / "apt-mirrors.txt"]
    for pattern in ("*.list", "*.sources"):
        sources.extend(sorted((apt_root / "sources.list.d").glob(pattern)))
    changed = 0
    for path in sources:
        if not path.is_file():
            continue
        before = path.read_bytes().decode("utf-8")
        after = use_https(before)
        if after != before:
            path.write_bytes(after.encode("utf-8"))
            print(f"Using Ubuntu HTTPS sources in {path}")
            changed += 1
    print(f"Updated {changed} Ubuntu source files; suites and signing options retained.")


if __name__ == "__main__":
    main()
