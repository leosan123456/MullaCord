"""Entrypoint do servidor Mulacord."""
import os

import uvicorn

if __name__ == "__main__":
    host = os.environ.get("MULACORD_HOST", "0.0.0.0")
    port = int(os.environ.get("MULACORD_PORT", "8787"))
    reload = os.environ.get("MULACORD_RELOAD", "0") == "1"
    uvicorn.run("mulacord_server.main:app", host=host, port=port, reload=reload)
