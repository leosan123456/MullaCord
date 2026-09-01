"""Smoke da replicação em enxame: 2 nós, DM entre contas de nós diferentes."""
import json
import sys
import time
import urllib.request

A = "http://127.0.0.1:8801"
B = "http://127.0.0.1:8802"


def req(base, method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(base + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    if token:
        r.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(r, timeout=8) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else None


def wait(secs, msg):
    print(f"  … esperando {secs}s ({msg})")
    time.sleep(secs)


def main():
    ts = str(int(time.time()))
    au, bu = "ana_" + ts, "beto_" + ts

    ra = req(A, "POST", "/api/auth/register", body={"username": au, "password": "senha123"})
    rb = req(B, "POST", "/api/auth/register", body={"username": bu, "password": "senha123"})
    ta, tb = ra["access_token"], rb["access_token"]
    print(f"ana id={ra['user']['id']} @A   beto id={rb['user']['id']} @B")

    wait(7, "contas replicam")
    users_on_a = {u["username"] for u in req(A, "GET", f"/api/users?q={bu}", ta)}
    assert bu in users_on_a, f"A não enxerga {bu}: {users_on_a}"
    print(f"OK — A enxerga {bu} no diretório")

    req(A, "POST", "/api/friends/request", ta, {"username": bu})
    print("ana pediu amizade")
    wait(7, "pedido replica p/ B")

    fr = req(B, "GET", "/api/friends", tb)
    pend = [f for f in fr if f.get("status") == "pending"]
    assert pend, f"beto não recebeu o pedido: {fr}"
    fid = pend[0]["id"]
    req(B, "POST", f"/api/friends/{fid}/accept", tb)
    print("beto aceitou")
    wait(7, "aceite replica p/ A")

    dm = req(A, "POST", "/api/channels/dm", ta, {"user_id": rb["user"]["id"]})
    cid = dm["id"]
    req(A, "POST", f"/api/channels/{cid}/messages", ta, {"content": "oi beto, isso é do nó A"})
    print(f"ana mandou mensagem no DM {cid}")
    wait(8, "DM + mensagem replicam p/ B")

    hist = req(B, "GET", f"/api/channels/{cid}/messages", tb)
    texts = [m["content"] for m in hist]
    assert "oi beto, isso é do nó A" in texts, f"beto não recebeu a mensagem: {texts}"
    print(f"OK — beto (nó B) vê a mensagem: {texts}")

    req(B, "POST", f"/api/channels/{cid}/messages", tb, {"content": "recebi! resposta do nó B"})
    wait(8, "resposta replica p/ A")
    hist_a = [m["content"] for m in req(A, "GET", f"/api/channels/{cid}/messages", ta)]
    assert "recebi! resposta do nó B" in hist_a, f"ana não recebeu a resposta: {hist_a}"
    print(f"OK — ana (nó A) vê os dois lados: {hist_a}")

    print("\nENXAME OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nFALHOU  {type(e).__name__}: {e}")
        sys.exit(1)
