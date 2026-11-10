"""Publish verified Foundry archives and write a candidate from downloaded bytes."""

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import zipfile
from contextlib import ExitStack
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

from pack import PINS, RIDS, archive_name, package_path, payload, verify_archive

REPO = "AtomicBot-ai/atomic-chat-conf"
TAG = "foundry-local-v2.4.0"


def gh(*args):
    return subprocess.check_output(["gh", *args], text=True)


def authenticated_release():
    # Drafts have no public tag endpoint until publication.
    info = json.loads(gh("release", "view", TAG, "--repo", REPO, "--json", "apiUrl"))
    return json.loads(gh("api", info["apiUrl"]))


def digest(path):
    with path.open("rb") as src:
        return hashlib.file_digest(src, "sha256").hexdigest()


def download(url, path):
    with urlopen(url, timeout=180) as src, path.open("wb") as dst:
        while block := src.read(1024 * 1024):
            dst.write(block)


def publish(cache, assets, candidate, min_core_version, target):
    # Recheck all local inputs before making any remote change.
    with ExitStack() as stack:
        packages = [(pin["id"], stack.enter_context(zipfile.ZipFile(package_path(cache, pin)))) for pin in PINS]
        for rid in RIDS:
            verify_archive(assets / archive_name(rid), *payload(rid, packages))

    # A 404 means the tag does not exist. Authentication/network failures propagate.
    url = f"https://api.github.com/repos/{REPO}/releases/tags/{TAG}"
    try:
        with urlopen(url, timeout=30) as response:
            release = json.load(response)
    except HTTPError as error:
        if error.code != 404:
            raise
        # gh can also see a draft left by an interrupted run.
        result = subprocess.run(
            ["gh", "release", "view", TAG, "--repo", REPO, "--json", "tagName"],
            capture_output=True, text=True,
        )
        if result.returncode:
            if result.stderr.strip() != "release not found":
                raise RuntimeError(result.stderr)
            gh("release", "create", TAG, "--repo", REPO, "--draft", "--target", target,
               "--title", "Foundry Local 2.4.0 native runtime",
               "--notes", "Five native archives repacked from the pinned Microsoft NuGet packages. "
               "Includes upstream licenses. The production manifest is published after consumer qualification.")
        release = authenticated_release()

    remote = {asset["name"]: asset for asset in release["assets"]}
    expected = {archive_name(rid) for rid in RIDS}
    if remote.keys() - expected:
        raise ValueError("Unexpected assets in release")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # Compare every existing asset before uploading any missing asset.
        for name, asset in remote.items():
            path = tmp / name
            gh("release", "download", TAG, "--repo", REPO, "--pattern", name, "--dir", str(tmp))
            if path.stat().st_size != (assets / name).stat().st_size or digest(path) != digest(assets / name):
                raise ValueError(f"Published asset differs: {name}")
        for name in sorted(expected - remote.keys()):
            gh("release", "upload", TAG, str(assets / name), "--repo", REPO)
        if release["draft"]:
            gh("release", "edit", TAG, "--repo", REPO, "--draft=false", "--latest=false")

        release = authenticated_release()
        remote = {asset["name"]: asset for asset in release["assets"]}
        if set(remote) != expected:
            raise ValueError("Published release does not have exactly five assets")
        entries = []
        for rid in RIDS:
            name = archive_name(rid)
            path = tmp / ("public-" + name)
            url = f"https://github.com/{REPO}/releases/download/{TAG}/{name}"
            download(url, path)
            sha256 = digest(path)
            size = path.stat().st_size
            if size != remote[name]["size"] or size != (assets / name).stat().st_size or sha256 != digest(assets / name):
                raise ValueError(f"Public download differs: {name}")
            api_digest = remote[name].get("digest")
            if api_digest and api_digest != "sha256:" + sha256:
                raise ValueError(f"GitHub digest differs: {name}")
            entries.append({"platform": "macos-arm64" if rid == "osx-arm64" else rid,
                            "name": name, "size": size, "sha256": sha256})
            print(f"{name}: public URL, size and SHA-256 verified", flush=True)

    base = json.loads(Path("backends/foundry-local-manifest.json").read_text())
    if any(entry["tag"] == "v2.4.0" for entry in base["releases"]):
        raise ValueError("Production already contains 2.4.0; review the candidate base")
    base["$schema"] = "./foundry-local-schema.json"
    base["releases"].insert(0, {
        "tag": "v2.4.0", "published_at": release["published_at"],
        "min_core_version": min_core_version, "c_api_version": 3,
        "notes_url": release["html_url"], "distribution": "atomic-conf", "assets": entries,
    })
    # Leave an existing candidate intact if any verification fails.
    with tempfile.NamedTemporaryFile(mode="w", dir=candidate.parent, delete=False) as dst:
        json.dump(base, dst, indent=2)
        dst.write("\n")
    Path(dst.name).replace(candidate)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("assets", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--min-core-version", required=True)
    parser.add_argument("--target", required=True, help="Remote commit or branch for the release tag")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", args.min_core_version):
        parser.error("--min-core-version must be X.Y.Z")
    publish(args.cache, args.assets, args.candidate, args.min_core_version, args.target)
