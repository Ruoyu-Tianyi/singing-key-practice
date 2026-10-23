"""Extract official Audiveris MSI files without installing the application.

Only MsiOpenDatabase (read-only), SQL reads and cabinet expansion are used.
No Windows Installer install API or custom action is invoked. The caller
verifies the official package SHA-256 before invoking this helper.
"""

import ctypes
from ctypes import wintypes
from pathlib import Path
import shutil
import subprocess
import sys

base = Path(sys.argv[1]).resolve()
source = base / "Audiveris-5.11.0-windowsConsole-x86_64.msi"
msi = ctypes.WinDLL("msi")
Handle = wintypes.UINT
msi.MsiOpenDatabaseW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(Handle)]
msi.MsiDatabaseOpenViewW.argtypes = [Handle, wintypes.LPCWSTR, ctypes.POINTER(Handle)]
msi.MsiViewExecute.argtypes = [Handle, Handle]
msi.MsiViewFetch.argtypes = [Handle, ctypes.POINTER(Handle)]
msi.MsiRecordGetStringW.argtypes = [Handle, Handle, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
msi.MsiRecordReadStream.argtypes = [Handle, Handle, ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD)]
msi.MsiCloseHandle.argtypes = [Handle]


def check(code: int) -> None:
    if code:
        raise RuntimeError(f"Windows MSI read failed with error {code}")


database = Handle()
# A null persist parameter means MSIDBOPEN_READONLY.
check(msi.MsiOpenDatabaseW(str(source), None, ctypes.byref(database)))


def query(sql: str, columns: int) -> list[list[str]]:
    view = Handle()
    check(msi.MsiDatabaseOpenViewW(database, sql, ctypes.byref(view)))
    rows = []
    try:
        check(msi.MsiViewExecute(view, 0))
        while True:
            record = Handle()
            status = msi.MsiViewFetch(view, ctypes.byref(record))
            if status == 259:  # ERROR_NO_MORE_ITEMS
                break
            check(status)
            try:
                row = []
                for column in range(1, columns + 1):
                    length = wintypes.DWORD(16384)
                    buffer = ctypes.create_unicode_buffer(length.value)
                    check(msi.MsiRecordGetStringW(record, column, buffer, ctypes.byref(length)))
                    row.append(buffer.value)
                rows.append(row)
            finally:
                msi.MsiCloseHandle(record)
    finally:
        msi.MsiCloseHandle(view)
    return rows


def extract_cabinet(name: str, destination: Path) -> None:
    view = Handle()
    escaped_name = name.replace("'", "''")
    sql = f"SELECT `Data` FROM `_Streams` WHERE `Name`='{escaped_name}'"
    check(msi.MsiDatabaseOpenViewW(database, sql, ctypes.byref(view)))
    record = Handle()
    try:
        check(msi.MsiViewExecute(view, 0))
        check(msi.MsiViewFetch(view, ctypes.byref(record)))
        cabinet = base / Path(name).name
        with cabinet.open("wb") as stream:
            while True:
                buffer = ctypes.create_string_buffer(1024 * 1024)
                length = wintypes.DWORD(len(buffer))
                check(msi.MsiRecordReadStream(record, 1, buffer, ctypes.byref(length)))
                if not length.value:
                    break
                stream.write(buffer.raw[:length.value])
    finally:
        msi.MsiCloseHandle(record)
        msi.MsiCloseHandle(view)
    # Native cabinet decompression; this does not launch the installer.
    subprocess.run(
        ["expand.exe", "-F:*", str(cabinet), str(destination)],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    print(f"Extracted {cabinet.name}: {cabinet.stat().st_size} bytes")


def main() -> None:
    extracted = base / "cabinet"
    extracted.mkdir(exist_ok=True)
    for (name,) in query("SELECT `Name` FROM `_Streams`", 1):
        if name.lower().endswith(".cab"):
            extract_cabinet(name, extracted)

    components = dict(query("SELECT `Component`, `Directory_` FROM `Component`", 2))
    directories = {
        key: (parent, name)
        for key, parent, name in query(
            "SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`", 3
        )
    }
    output = base / "audiveris-portable"
    output.mkdir(exist_ok=True)

    def folder(key: str, visited: frozenset[str] = frozenset()) -> Path:
        if not key or key == "TARGETDIR":
            return output
        if key in visited:
            raise RuntimeError("Cyclic MSI directory reference")
        parent, name = directories[key]
        name = name.split(":")[0].split("|")[-1]
        parent_path = folder(parent, visited | {key})
        return parent_path if name in {".", "SourceDir"} else parent_path / name

    count = 0
    for key, component, name in query("SELECT `File`, `Component_`, `FileName` FROM `File`", 3):
        original = extracted / key
        target = folder(components[component]) / name.split("|")[-1]
        if not original.resolve().is_relative_to(extracted):
            raise RuntimeError("Unsafe archive path")
        if not target.resolve().is_relative_to(output):
            raise RuntimeError("Unsafe output path")
        if not original.exists():
            raise FileNotFoundError(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original, target)
        count += 1
    print(f"Copied {count} files into {output}")


try:
    main()
finally:
    msi.MsiCloseHandle(database)
