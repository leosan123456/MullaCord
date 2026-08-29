// Renderização da visão de servidor: sidebar de canais, lista de membros e modais.
import { $, el, state, currentGuild, memberName, hoistedRoleFor, avatarNode, toast } from "./store.js";
import { P, PERMISSION_LABELS, has, guildPermissions, channelPermissions } from "./permissions.js";
import { icon } from "./icons.js";
import { openChannelSettings } from "./settings.js";

let CTX = null;
export function initGuildUI(ctx) { CTX = ctx; }

// ---------------------------------------------------------------- sidebar
export function renderGuildSidebar() {
  const g = currentGuild();
  if (!g) return;
  $("guild-name").textContent = g.name;
  const myPerms = guildPermissions(g, state.me.id);
  const isOwner = g.owner_id === state.me.id;

  const menu = $("guild-menu");
  menu.querySelector('[data-act="new-channel"]').hidden = !has(myPerms, P.MANAGE_CHANNELS);
  menu.querySelector('[data-act="new-category"]').hidden = !has(myPerms, P.MANAGE_CHANNELS);
  menu.querySelector('[data-act="roles"]').hidden = !has(myPerms, P.MANAGE_ROLES);
  menu.querySelector('[data-act="invite"]').hidden = !has(myPerms, P.CREATE_INVITE);
  menu.querySelector('[data-act="leave"]').hidden = isOwner;
  menu.querySelector('[data-act="delete"]').hidden = !isOwner;

  const box = $("guild-channels");
  box.replaceChildren();

  const visible = g.channels.filter((c) => has(channelPermissions(g, c, state.me.id), P.VIEW_CHANNEL));
  const cats = [...g.categories].sort((a, b) => a.position - b.position);
  const groups = [{ id: null, name: null }, ...cats];

  for (const cat of groups) {
    const chans = visible
      .filter((c) => (c.category_id || null) === cat.id)
      .sort((a, b) => a.position - b.position);
    if (!chans.length && cat.id === null) continue;
    if (cat.name) {
      const h = el("div", "cat-head");
      h.append(icon("chevronDown", 12), el("span", null, cat.name));
      box.append(h);
    }
    for (const c of chans) box.append(channelRow(g, c));
  }
}

function channelRow(g, c) {
  const row = el("div", "chan-row" + (c.id === state.activeChannelId ? " active" : ""));
  row.dataset.cid = c.id;
  const sig = el("span", "sig");
  sig.append(icon(c.type === "voice" ? "volume" : "hash", 16));
  row.append(sig, el("span", "name", c.name));
  row.addEventListener("click", () => {
    if (c.type === "voice") CTX.joinVoice(c.id);
    else CTX.openText(c.id);
  });

  const myPerms = guildPermissions(g, state.me.id);
  if (has(myPerms, P.MANAGE_CHANNELS) || has(myPerms, P.MANAGE_ROLES)) {
    const gear = el("button", "gear icon-btn");
    gear.append(icon("settings", 14));
    gear.title = "Configurações do canal";
    gear.addEventListener("click", (e) => { e.stopPropagation(); openChannelSettings(c.id); });
    row.append(gear);
  }

  const wrap = el("div");
  wrap.append(row);
  if (c.type === "voice") {
    const inChan = [...state.voiceStates.entries()]
      .filter(([, s]) => s.channelId === c.id)
      .map(([uid]) => uid);
    if (inChan.length) {
      const vm = el("div", "voice-members");
      for (const uid of inChan) {
        const line = el("div", "vm");
        line.append(avatarNode(uid, "avatar-sm", memberName(uid)), el("span", null, memberName(uid)));
        vm.append(line);
      }
      wrap.append(vm);
    }
  }
  return wrap;
}

// ---------------------------------------------------------------- lista de membros
export function renderMemberList() {
  const g = currentGuild();
  const box = $("memberlist");
  if (!g) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren();

  const hoistRoles = g.roles.filter((r) => r.hoist).sort((a, b) => b.position - a.position);
  const buckets = new Map(hoistRoles.map((r) => [r.id, []]));
  const online = [];
  const offline = [];

  for (const m of g.members) {
    const isOnline = state.online.has(m.id);
    const hr = hoistedRoleFor(g, m);
    if (hr && isOnline) buckets.get(hr.id).push(m);
    else if (isOnline) online.push(m);
    else offline.push(m);
  }

  const section = (title, members) => {
    if (!members.length) return;
    box.append(el("div", "grp", `${title} — ${members.length}`));
    for (const m of members.sort((a, b) => memberName(a.id).localeCompare(memberName(b.id)))) {
      const row = el("div", "mrow" + (state.online.has(m.id) ? "" : " offline"));
      row.append(avatarNode(m.id, "avatar-sm", m.nickname || m.display_name));
      const topRole = m.role_ids
        .map((id) => g.roles.find((r) => r.id === id))
        .filter(Boolean)
        .sort((a, b) => b.position - a.position)[0];
      const name = el("span", "rname", m.nickname || m.display_name);
      if (topRole && topRole.color) name.style.color = topRole.color;
      row.append(name);
      if (m.id === g.owner_id) {
        const c = icon("crown", 13);
        c.style.color = "var(--accent)";
        row.append(c);
      }
      row.addEventListener("click", () => openMemberModal(g, m));
      box.append(row);
    }
  };

  for (const r of hoistRoles) section(r.name, buckets.get(r.id));
  section("Online", online);
  section("Offline", offline);
}

// ---------------------------------------------------------------- modais
function modal(title, buildBody, buttons) {
  const root = $("modal-root");
  const back = el("div", "modal");
  const card = el("div", "modal-card");
  card.append(el("h3", null, title));
  const body = el("div");
  buildBody(body);
  card.append(body);
  const actions = el("div", "modal-actions");
  for (const [label, fn, cls] of buttons) {
    const b = el("button", cls || "ghost", label);
    b.addEventListener("click", async () => {
      try { await fn(card); } catch (e) { toast(e.message, "error"); return; }
      back.remove();
    });
    actions.append(b);
  }
  card.append(actions);
  back.append(card);
  back.addEventListener("click", (e) => { if (e.target === back) back.remove(); });
  root.append(back);
  return card;
}

export function openGuildMenuAction(act) {
  const g = currentGuild();
  if (act === "invite") return inviteModal(g);
  if (act === "new-channel") return channelModal(g);
  if (act === "new-category") return categoryModal(g);
  if (act === "roles") return rolesModal(g);
  if (act === "nickname") return nicknameModal(g);
  if (act === "leave") return leaveModal(g);
  if (act === "delete") return deleteModal(g);
}

async function inviteModal(g) {
  const res = await state.api.createInvite(g.id, { max_uses: 0 });
  modal("Convite do servidor", (body) => {
    body.append(el("p", "muted", "Compartilhe este código. Quem tiver acesso ao servidor pode entrar."));
    body.append(el("div", "invite-code", res.code));
  }, [["Fechar", () => {}]]);
}

function channelModal(g) {
  let name, type, cat;
  modal("Criar canal", (body) => {
    const l1 = el("label", null, "Nome"); name = el("input"); l1.append(name);
    const l2 = el("label", null, "Tipo");
    type = el("select");
    type.innerHTML = '<option value="text">Texto</option><option value="voice">Voz</option>';
    l2.append(type);
    const l3 = el("label", null, "Categoria");
    cat = el("select");
    cat.innerHTML = '<option value="">— nenhuma —</option>' +
      g.categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    l3.append(cat);
    body.append(l1, l2, l3);
  }, [["Cancelar", () => {}], ["Criar", async () => {
    await state.api.createChannel(g.id, {
      name: name.value.trim(), type: type.value,
      category_id: cat.value ? +cat.value : null,
    });
    toast("Canal criado", "success");
  }, "primary"]]);
}

function categoryModal(g) {
  let name;
  modal("Criar categoria", (body) => {
    const l = el("label", null, "Nome"); name = el("input"); l.append(name);
    body.append(l);
  }, [["Cancelar", () => {}], ["Criar", async () => {
    await state.api.createCategory(g.id, name.value.trim());
    toast("Categoria criada", "success");
  }, "primary"]]);
}

function nicknameModal(g) {
  let inp;
  const meMember = g.members.find((m) => m.id === state.me.id);
  modal("Mudar apelido", (body) => {
    const l = el("label", null, "Apelido (vazio = nome real)");
    inp = el("input"); inp.value = meMember?.nickname || "";
    l.append(inp); body.append(l);
  }, [["Cancelar", () => {}], ["Salvar", async () => {
    await state.api.setNickname(g.id, inp.value.trim() || null);
  }, "primary"]]);
}

function leaveModal(g) {
  modal("Sair do servidor", (body) => {
    body.append(el("p", null, `Sair de "${g.name}"? Você precisará de um novo convite para voltar.`));
  }, [["Cancelar", () => {}], ["Sair", async () => {
    await state.api.leaveGuild(g.id);
  }, "danger-text"]]);
}

function deleteModal(g) {
  modal("Apagar servidor", (body) => {
    body.append(el("p", null, `Apagar "${g.name}" para sempre? Isso remove todos os canais e mensagens.`));
  }, [["Cancelar", () => {}], ["Apagar", async () => {
    await state.api.deleteGuild(g.id);
  }, "danger-text"]]);
}

function openMemberModal(g, m) {
  const myPerms = guildPermissions(g, state.me.id);
  const canRoles = has(myPerms, P.MANAGE_ROLES);
  const canKick = has(myPerms, P.KICK_MEMBERS) && m.id !== g.owner_id && m.id !== state.me.id;

  modal(`${m.nickname || m.display_name} (@${m.username})`, (body) => {
    body.append(el("p", "muted", m.id === g.owner_id ? "Dono do servidor" : "Membro"));
    if (canRoles) {
      body.append(el("div", "grp", "Cargos"));
      const list = el("div", "member-admin");
      for (const r of g.roles.filter((x) => !x.is_default).sort((a, b) => b.position - a.position)) {
        const lab = el("label");
        const cb = el("input"); cb.type = "checkbox";
        cb.checked = m.role_ids.includes(r.id);
        cb.addEventListener("change", async () => {
          try {
            if (cb.checked) await state.api.addMemberRole(g.id, m.id, r.id);
            else await state.api.removeMemberRole(g.id, m.id, r.id);
          } catch (e) { toast(e.message, "error"); cb.checked = !cb.checked; }
        });
        lab.append(cb, el("span", null, r.name));
        list.append(lab);
      }
      body.append(list);
    }
  }, canKick
    ? [["Fechar", () => {}], ["Expulsar", async () => { await state.api.kickMember(g.id, m.id); toast("Membro expulso", "success"); }, "danger-text"]]
    : [["Fechar", () => {}]]);
}

function rolesModal(g) {
  modal("Cargos & permissões", (body) => {
    const myPerms = guildPermissions(g, state.me.id);
    const newBtn = el("button", "primary", "＋ Novo cargo");
    newBtn.addEventListener("click", async () => {
      try { await state.api.createRole(g.id, { name: "novo cargo", permissions: 0 }); }
      catch (e) { toast(e.message, "error"); }
    });
    body.append(newBtn);

    for (const r of [...g.roles].sort((a, b) => b.position - a.position)) {
      const wrap = el("div", "role-list");
      const head = el("div", "tag-row");
      head.append(el("strong", null, r.name + (r.is_default ? " (todos)" : "")));
      if (!r.is_default) {
        const del = el("button", "danger-text", "apagar");
        del.addEventListener("click", async () => {
          try { await state.api.deleteRole(r.id); } catch (e) { toast(e.message, "error"); }
        });
        head.append(del);
      }
      wrap.append(head);

      const grid = el("div", "perm-grid");
      for (const [flag, label] of Object.entries(PERMISSION_LABELS)) {
        const bit = P[flag];
        const lab = el("label");
        const cb = el("input"); cb.type = "checkbox";
        cb.checked = (r.permissions & bit) === bit;
        cb.disabled = !has(myPerms, bit) && g.owner_id !== state.me.id;
        cb.addEventListener("change", async () => {
          const next = cb.checked ? r.permissions | bit : r.permissions & ~bit;
          try {
            await state.api.patchRole(r.id, { permissions: next });
            r.permissions = next;
          } catch (e) { toast(e.message, "error"); cb.checked = !cb.checked; }
        });
        lab.append(cb, el("span", null, label));
        grid.append(lab);
      }
      wrap.append(grid);
      body.append(wrap);
    }
  }, [["Fechar", () => {}]]);
}
