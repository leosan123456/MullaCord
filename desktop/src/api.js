// Cliente REST do servidor Mulacord.

// FastAPI manda `detail` como string (HTTPException) ou array (validação 422).
function errorText(data) {
  const d = data && data.detail;
  if (!d) return null;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => {
        const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : "";
        return field ? `${field}: ${e.msg}` : e.msg;
      })
      .join("; ");
  }
  return String(d);
}

export class Api {
  constructor(baseUrl, token = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  async _req(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(errorText(data) || `${res.status} ${res.statusText}`);
    }
    return data;
  }

  get(p) { return this._req("GET", p); }
  post(p, b) { return this._req("POST", p, b); }
  patch(p, b) { return this._req("PATCH", p, b); }
  put(p, b) { return this._req("PUT", p, b); }
  del(p) { return this._req("DELETE", p); }

  // -- auth --
  info() { return this.get("/api/info"); }
  register(payload) { return this.post("/api/auth/register", payload); }
  login(payload) { return this.post("/api/auth/login", payload); }
  me() { return this.get("/api/auth/me"); }
  updateProfile(body) { return this.patch("/api/auth/me", body); }

  // -- amigos --
  friends() { return this.get("/api/friends"); }
  addFriend(username) { return this.post("/api/friends/request", { username }); }
  acceptFriend(id) { return this.post(`/api/friends/${id}/accept`); }
  removeFriend(id) { return this.del(`/api/friends/${id}`); }

  // -- canais --
  channels() { return this.get("/api/channels"); }
  openDM(userId) { return this.post("/api/channels/dm", { user_id: userId }); }
  createGroup(name, memberIds) {
    return this.post("/api/channels/group", { name, member_ids: memberIds });
  }
  addMember(channelId, userId) {
    return this.post(`/api/channels/${channelId}/members/${userId}`);
  }
  leaveChannel(channelId) {
    return this.del(`/api/channels/${channelId}/members/me`);
  }

  // -- mensagens --
  history(channelId, before) {
    const q = before ? `?before=${before}` : "";
    return this.get(`/api/channels/${channelId}/messages${q}`);
  }
  sendMessageRest(channelId, content) {
    return this.post(`/api/channels/${channelId}/messages`, { content });
  }
  editMessage(channelId, messageId, content) {
    return this.patch(`/api/channels/${channelId}/messages/${messageId}`, { content });
  }
  deleteMessage(channelId, messageId) {
    return this.del(`/api/channels/${channelId}/messages/${messageId}`);
  }

  async uploadAttachments(channelId, files, onProgress) {
    const fd = new FormData();
    for (const f of files) fd.append("files", f, f.name || "anexo");
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this.baseUrl}/api/channels/${channelId}/attachments`);
      xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error((data && (data.detail || data.message)) || `upload falhou (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("falha de rede no upload"));
      xhr.send(fd);
    });
  }

  attachmentUrl(att) {
    return `${this.baseUrl}${att.url}?t=${encodeURIComponent(this.token)}`;
  }

  // -- servidores (guilds) --
  permissionFlags() { return this.get("/api/permissions"); }
  guilds() { return this.get("/api/guilds"); }
  createGuild(name) { return this.post("/api/guilds", { name }); }
  patchGuild(gid, body) { return this.patch(`/api/guilds/${gid}`, body); }
  deleteGuild(gid) { return this.del(`/api/guilds/${gid}`); }
  leaveGuild(gid) { return this.del(`/api/guilds/${gid}/members/@me`); }
  setNickname(gid, nickname) { return this.patch(`/api/guilds/${gid}/members/@me`, { nickname }); }
  kickMember(gid, uid) { return this.del(`/api/guilds/${gid}/members/${uid}`); }

  createInvite(gid, opts = {}) { return this.post(`/api/guilds/${gid}/invites`, opts); }
  previewInvite(code) { return this.get(`/api/invites/${code}`); }
  useInvite(code) { return this.post(`/api/invites/${code}`); }

  createCategory(gid, name) { return this.post(`/api/guilds/${gid}/categories`, { name }); }
  deleteCategory(catId) { return this.del(`/api/categories/${catId}`); }

  createChannel(gid, body) { return this.post(`/api/guilds/${gid}/channels`, body); }
  patchChannel(cid, body) { return this.patch(`/api/channels/${cid}`, body); }
  deleteChannel(cid) { return this.del(`/api/channels/${cid}`); }
  setOverwrite(cid, type, id, allow, deny) {
    return this.put(`/api/channels/${cid}/overwrites/${type}/${id}`, { allow, deny });
  }
  clearOverwrite(cid, type, id) {
    return this.del(`/api/channels/${cid}/overwrites/${type}/${id}`);
  }

  createRole(gid, body) { return this.post(`/api/guilds/${gid}/roles`, body); }
  patchRole(rid, body) { return this.patch(`/api/roles/${rid}`, body); }
  deleteRole(rid) { return this.del(`/api/roles/${rid}`); }
  addMemberRole(gid, uid, rid) { return this.put(`/api/guilds/${gid}/members/${uid}/roles/${rid}`); }
  removeMemberRole(gid, uid, rid) { return this.del(`/api/guilds/${gid}/members/${uid}/roles/${rid}`); }
}
