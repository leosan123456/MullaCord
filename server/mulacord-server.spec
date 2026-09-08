# PyInstaller spec — empacota o servidor Mulacord num executável (onedir).
# Build:  py -m PyInstaller mulacord-server.spec --noconfirm
from PyInstaller.utils.hooks import collect_submodules, collect_all

datas, binaries, hiddenimports = [], [], []
for pkg in ("uvicorn", "fastapi", "starlette", "anyio"):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h

hiddenimports += collect_submodules("mulacord_server")
hiddenimports += [
    "uvicorn.loops.auto", "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto", "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto", "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan.on", "uvicorn.logging",
    "websockets", "websockets.legacy", "aiosqlite", "jwt",
]

# O servidor sobe sempre sem --reload e sem --log-config yaml, então watchfiles
# (Rust ~0.6 MB) e PyYAML (~0.3 MB) são peso morto — uvicorn os importa de forma
# opcional e tolera a ausência. tzdata idem (SQLite guarda tudo em UTC/epoch).
_DEAD_WEIGHT = [
    "tkinter", "matplotlib", "numpy", "PIL",
    "watchfiles", "yaml", "_yaml", "tzdata",
    "pytest", "_pytest", "IPython", "pydoc_data",
]

a = Analysis(
    ["run.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    excludes=_DEAD_WEIGHT,
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="mulacord-server",
    console=True,
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe, a.binaries, a.datas,
    strip=False, upx=False,
    name="mulacord-server",
)
