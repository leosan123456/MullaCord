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

a = Analysis(
    ["run.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    excludes=["tkinter", "matplotlib", "numpy", "PIL"],
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
