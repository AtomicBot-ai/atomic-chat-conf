"""Build the five Foundry Local 2.4.0 archives from NuGet catalog pins."""

import argparse
import base64
import gzip
import hashlib
import io
import json
import os
import tarfile
import tempfile
import zipfile
from contextlib import ExitStack
from pathlib import Path
from urllib.request import urlopen
from shutil import copyfileobj

PINS = json.loads(Path(__file__).with_name("packages.json").read_text())
RIDS = ("win-x64", "win-arm64", "osx-arm64", "linux-x64", "linux-arm64")
LICENSES = {"LICENSE", "LICENSE.txt", "ThirdPartyNotices.txt", "Privacy.md"}


def archive_name(rid):
    extension = "zip" if rid.startswith("win-") else "tgz"
    return f"foundry-local-{rid}.{extension}"


def check_package(path, pin):
    with path.open("rb") as src:
        digest = hashlib.file_digest(src, "sha512").digest()
    if digest != base64.b64decode(pin["packageHash"], validate=True):
        raise ValueError(f"NuGet SHA-512 mismatch for {path.name}")


def package_path(cache, pin):
    name, version = pin["id"].lower(), pin["version"]
    filename = f"{name}.{version}.nupkg"
    path = cache / filename
    if not path.exists():
        url = f"https://api.nuget.org/v3-flatcontainer/{name}/{version}/{filename}"
        with tempfile.TemporaryDirectory(dir=cache) as tmp:
            download = Path(tmp) / filename
            with urlopen(url, timeout=120) as src, download.open("wb") as dst:
                copyfileobj(src, dst)
            check_package(download, pin)
            download.replace(path)
    else:
        check_package(path, pin)
    return path


def payload(rid, packages):
    files = {}
    links = {}
    prefix = f"runtimes/{rid}/native/"
    for package, source in packages:
        names = source.namelist()
        natives = [name for name in names if name.startswith(prefix) and not name.endswith("/")]
        licenses = LICENSES.intersection(names)
        if not natives or not {"LICENSE", "LICENSE.txt"}.intersection(licenses):
            raise ValueError(f"{package}: missing {rid} natives or license")
        for name in sorted([*natives, *licenses]):
            if name in licenses:
                dest = f"licenses/{package}/{name}"
            else:
                basename = name.removeprefix(prefix)
                if not basename or "/" in basename or "\\" in basename or basename in (".", ".."):
                    raise ValueError(f"Unexpected native path {name}")
                dest = f"lib/{basename}"
            if dest in files:
                raise ValueError(f"Duplicate archive path {dest}")
            executable = source.getinfo(name).external_attr >> 16 & 0o111
            mode = 0o755 if executable or dest == "lib/foundry-local-host" else 0o644
            files[dest] = (source.read(name), mode)

    manifest = json.loads(files["lib/foundry-local-runtime.json"][0])
    if manifest["rid"] != rid:
        raise ValueError(f"Runtime manifest RID mismatch for {rid}")
    for component in ("native", "host"):
        entry = manifest[component]
        data = files["lib/" + entry["file_name"]][0]
        if hashlib.sha256(data).hexdigest() != entry["sha256"].lower():
            raise ValueError(f"{rid}: runtime manifest hash mismatch for {component}")

    if rid.startswith("linux-"):
        links["lib/libonnxruntime.so.1"] = "libonnxruntime.so"
    elif rid == "osx-arm64":
        real = "libonnxruntime.1.31.0.dylib"
        files["lib/" + real] = files.pop("lib/libonnxruntime.dylib")
        links = {f"lib/{alias}": real for alias in ("libonnxruntime.dylib", "libonnxruntime.1.dylib")}
    if any("lib/" + target not in files for target in links.values()):
        raise ValueError(f"{rid}: missing ORT symlink target")
    return files, links


def write_archive(path, files, links):
    if path.suffix == ".zip":
        with zipfile.ZipFile(path, "w") as archive:
            for name, (data, mode) in sorted(files.items()):
                info = zipfile.ZipInfo(name)  # fixed DOS timestamp
                info.create_system = 3
                info.external_attr = (0o100000 | mode) << 16
                archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
        return
    with path.open("wb") as raw, gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0, compresslevel=6) as gz:
        with tarfile.open(fileobj=gz, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, (data, mode) in sorted(files.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mode = len(data), mode
                archive.addfile(info, io.BytesIO(data))
            for name, target in sorted(links.items()):
                info = tarfile.TarInfo(name)
                info.type, info.linkname, info.mode = tarfile.SYMTYPE, target, 0o777
                archive.addfile(info)


def verify_archive(path, files, links):
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as archive:
            if sorted(archive.namelist()) != sorted(files):
                raise ValueError(f"Wrong ZIP inventory in {path.name}")
            for name, (data, mode) in files.items():
                if archive.read(name) != data or archive.getinfo(name).external_attr >> 16 & 0o777 != mode:
                    raise ValueError(f"ZIP member differs: {name}")
    else:
        with tarfile.open(path, "r:gz") as archive:
            if sorted(archive.getnames()) != sorted([*files, *links]):
                raise ValueError(f"Wrong tar inventory in {path.name}")
            for name, (data, mode) in files.items():
                item = archive.getmember(name)
                if not item.isfile() or item.mode != mode or archive.extractfile(item).read() != data:
                    raise ValueError(f"Tar member differs: {name}")
            for name, target in links.items():
                item = archive.getmember(name)
                if not item.issym() or item.linkname != target:
                    raise ValueError(f"Wrong ORT alias {name}")


def build(cache, out):
    cache.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    with ExitStack() as stack, tempfile.TemporaryDirectory(dir=out) as tmp:
        packages = [(pin["id"], stack.enter_context(zipfile.ZipFile(package_path(cache, pin)))) for pin in PINS]
        for rid in RIDS:
            path = Path(tmp) / archive_name(rid)
            files, links = payload(rid, packages)
            write_archive(path, files, links)
            verify_archive(path, files, links)
            print(f"{rid}: verified {len(files)} files and {len(links)} links", flush=True)
        for rid in RIDS:
            name = archive_name(rid)
            os.replace(Path(tmp) / name, out / name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path, help="Directory for the three pinned nupkgs")
    parser.add_argument("out", type=Path, help="Directory for the five verified archives")
    args = parser.parse_args()
    build(args.cache, args.out)
