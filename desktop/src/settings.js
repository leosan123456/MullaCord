// Modais de configuração: voz, perfil do usuário e canal (com editor de overwrites).
import { $, el, state, currentGuild, toast, loadUi, saveUi, ACCENT_PRESETS, loadGameCfg, saveGameCfg } from "./store.js";
import { P, PERMISSION_LABELS, guildPermissions, has } from "./permissions.js";
import { icon } from "./icons.js";
import { loadAudio, saveAudio, listDevices, createMeter } from "./audio.js";

// ---------------------------------------------------------------- util
export function overlay(title, width = 460) {
  const back = el("div", "modal");
  const card = el("div", "modal-card");
  if (width) card.style.width = width + "px";
  card.append(el("h3", null, title));
  const body = el("div");
  card.append(body);
  back.append(card);
  const cleanups = [];
  const close = () => { cleanups.forEach((fn) => fn()); back.remove(); };
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  document.body.append(back);
  return { body, card, close, back, onClose: (fn) => cleanups.push(fn) };
}

function labeled(text, control) {
  const l = el("label", null, text);
  l.append(control);
  return l;
}

function toggleRow(text, checked, onChange) {
  const row = el("label", "toggle-row");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = !!checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  row.append(el("span", null, text), cb);
  return row;
}

async function pickImageDataURL(maxPx = 128) {
  return new Promise((resolve) => {
    const inp = el("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => {
      const file = inp.files[0];
      if (!file) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(maxPx / img.width, maxPx / img.height, 1);
        const c = el("canvas");
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = URL.createObjectURL(file);
    };
    inp.click();
  });
}

// ---------------------------------------------------------------- perfil
export function openUserSettings() {
  const { body, close } = overlay("Meu perfil");
  let avatar = state.me.avatar || null;

  const preview = el("div", "avatar-lg");
  const setPrev = () => {
    preview.replaceChildren();
    if (avatar) {
      const img = el("img");
      img.src = avatar;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
      preview.append(img);
    } else {
      preview.textContent = (state.me.display_name || "?")[0].toUpperCase();
    }
  };
  setPrev();

  const name = el("input");
  name.value = state.me.display_name;

  const pick = el("button", "ghost");
  pick.append(icon("image", 15), el("span", null, "Escolher foto…"));
  pick.addEventListener("click", async () => {
    const d = await pickImageDataURL(128);
    if (d) { avatar = d; setPrev(); }
  });
  const clear = el("button", "ghost", "Remover");
  clear.addEventListener("click", () => { avatar = null; setPrev(); });

  const row = el("div", "row");
  row.append(pick, clear);
  body.append(preview, row);
  body.append(labeled("Nome de exibição", name));

  // aparência
  body.append(el("div", "grp", "Aparência"));
  body.append(appearanceControls());

  // comunidade
  if (window.mula?.community) {
    body.append(el("div", "grp", "Comunidade"));
    body.append(communityControls(close));
  }

  // jogos
  if (window.mula?.game) {
    body.append(el("div", "grp", "Status de jogo"));
    body.append(gameControls());
  }

  const actions = el("div", "modal-actions");
  const cancel = el("button", "ghost", "Cancelar");
  cancel.addEventListener("click", close);
  const save = el("button", "primary", "Salvar");
  save.addEventListener("click", async () => {
    try {
      const res = await state.api.updateProfile({
        display_name: name.value.trim(),
        avatar: avatar ?? "",
      });
      state.me = { ...state.me, ...res };
      close();
      window.dispatchEvent(new CustomEvent("mula:refresh"));
      toast("Perfil salvo", "success");
    } catch (e) { toast(e.message, "error"); }
  });
  actions.append(cancel, save);
  body.append(actions);
}

// ---------------------------------------------------------------- comunidade
function communityControls(closeModal) {
  const box = el("div", "member-admin");
  const c = state.community || {};

  box.append(el("p", "field-hint", `Você está em "${c.name || "sua comunidade"}". Quem abre o Mulla Cord na mesma rede vê e entra sozinho.`));

  const inviteWrap = el("div", "host-addr");
  const link = el("span", "ha-link", "gerando convite…");
  inviteWrap.append(link);
  const copy = el("button", "ha-copy icon-btn");
  copy.append(icon("link", 13));
  copy.title = "Copiar convite";
  inviteWrap.append(copy);
  box.append(labeled("Convite (para amigos de outra rede)", inviteWrap));

  window.mula.community.invite().then((inv) => {
    link.textContent = inv.link;
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(inv.link);
      toast("Convite copiado", "success");
    });
  }).catch(() => { link.textContent = "indisponível"; });

  const pub = el("input");
  pub.placeholder = "ex.: meu-ip-publico:8787 (opcional)";
  pub.value = c.publicHost || "";
  const pubSave = el("button", "ghost", "Salvar endereço público");
  pubSave.addEventListener("click", async () => {
    try {
      await window.mula.community.update({ publicHost: pub.value.trim() });
      toast("Endereço salvo — reiniciando o nó", "success");
    } catch (e) { toast(e.message, "error"); }
  });
  box.append(labeled("Endereço público", pub), pubSave);

  // preferências deste dispositivo (bandeja / semente do enxame)
  if (window.mula?.prefs) {
    box.append(el("p", "sub-label", "Este dispositivo"));
    window.mula.prefs.get().then((p) => {
      box.append(
        toggleRow("Manter no ar em segundo plano (fechar vai pra bandeja)", p.background,
          (v) => window.mula.prefs.set({ background: v })),
        toggleRow("Iniciar com o Windows", p.openAtLogin,
          (v) => window.mula.prefs.set({ openAtLogin: v })),
      );
    });
  }

  const leave = el("button", "danger-text", "Sair desta comunidade");
  leave.addEventListener("click", () => {
    if (state.community) {
      localStorage.removeItem("mula.comm.setup." + state.community.id);
      localStorage.removeItem("mula.session." + state.community.id);
    }
    window.mula.community.update({ name: "Minha comunidade" }).finally(() => location.reload());
  });
  const leaveRow = el("div", "row");
  leaveRow.append(leave);
  box.append(leaveRow);

  return box;
}

// ---------------------------------------------------------------- status de jogo
function gameControls() {
  const wrap = el("div", "game-cfg");
  let cfg = loadGameCfg();
  const persist = () => saveGameCfg(cfg);

  const render = () => {
    wrap.replaceChildren();

    const row = el("label", "toggle-row");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = cfg.enabled !== false;
    cb.addEventListener("change", () => { cfg.enabled = cb.checked; persist(); render(); });
    row.append(el("span", null, "Mostrar aos amigos o jogo que estou jogando"), cb);
    wrap.append(row);

    if (cfg.enabled === false) return;

    wrap.append(el("p", "field-hint",
      "O app reconhece jogos populares automaticamente. Adicione outros abaixo."));

    const custom = cfg.custom || {};
    if (Object.keys(custom).length) {
      const list = el("div", "member-admin");
      for (const [exe, nm] of Object.entries(custom)) {
        const r = el("div", "tag-row");
        r.append(el("strong", null, nm), el("span", "muted small", exe));
        const rm = el("button", "danger-text", "remover");
        rm.addEventListener("click", () => { delete cfg.custom[exe]; persist(); render(); });
        r.append(rm);
        list.append(r);
      }
      wrap.append(list);
    }

    const add = el("button", "ghost", "＋ Adicionar jogo");
    add.addEventListener("click", () => addGameModal(cfg, () => { persist(); render(); }));
    wrap.append(add);
  };

  render();
  return wrap;
}

function addGameModal(cfg, done) {
  const { body, close } = overlay("Adicionar jogo", 420);
  body.append(el("p", "muted", "Deixe o jogo aberto e escolha o processo dele:"));
  const sel = el("select");
  sel.innerHTML = "<option>carregando…</option>";
  window.mula.game.candidates().then((procs) => {
    sel.innerHTML = procs.map((p) => `<option value="${p}">${p}</option>`).join("")
      || "<option value=''>nenhum processo candidato</option>";
  });
  const nm = el("input"); nm.placeholder = "Nome que vai aparecer (ex.: Meu Jogo)";
  body.append(labeled("Processo", sel), labeled("Nome", nm));
  const actions = el("div", "modal-actions");
  const c = el("button", "ghost", "Cancelar"); c.addEventListener("click", close);
  const ok = el("button", "primary", "Adicionar");
  ok.addEventListener("click", () => {
    const exe = sel.value, name = nm.value.trim();
    if (!exe || !name) return;
    cfg.custom = cfg.custom || {};
    cfg.custom[exe] = name;
    close();
    done();
  });
  actions.append(c, ok);
  body.append(actions);
}

// ---------------------------------------------------------------- personalização
export function appearanceControls() {
  const wrap = el("div", "appearance");
  let ui = loadUi();
  const set = (patch) => { ui = saveUi(patch); render(); };

  function render() {
    wrap.replaceChildren();

    // tema
    const themeBox = el("div", "theme-toggle");
    for (const [val, label, ic] of [["dark", "Escuro", "moon"], ["light", "Claro", "sun"]]) {
      const b = el("button", ui.theme === val ? "active" : "");
      b.append(icon(ic, 15), el("span", null, label));
      b.addEventListener("click", () => set({ theme: val }));
      themeBox.append(b);
    }
    wrap.append(themeBox);

    // cor de acento
    wrap.append(el("div", "sub-label", "Cor de destaque"));
    const swatches = el("div", "swatches");
    for (const [name, hex] of Object.entries(ACCENT_PRESETS)) {
      const s = el("button", "swatch" + (ui.accent.toLowerCase() === hex ? " on" : ""));
      s.style.background = hex;
      s.title = name;
      s.addEventListener("click", () => set({ accent: hex }));
      swatches.append(s);
    }
    const custom = el("label", "swatch custom");
    custom.title = "Cor personalizada";
    const cin = el("input"); cin.type = "color"; cin.value = ui.accent;
    cin.addEventListener("input", () => set({ accent: cin.value }));
    custom.append(cin, icon("plus", 13));
    swatches.append(custom);
    wrap.append(swatches);

    // fundo
    wrap.append(el("div", "sub-label", "Fundo"));
    const bgBox = el("div", "seg-choice");
    for (const [val, label] of [["gradient", "Gradiente"], ["aurora", "Aurora"], ["solid", "Sólido"]]) {
      const b = el("button", ui.bg === val ? "active" : "");
      b.textContent = label;
      b.addEventListener("click", () => set({ bg: val }));
      bgBox.append(b);
    }
    wrap.append(bgBox);

    // toggles
    for (const [key, label] of [["parallax", "Efeito parallax no login"], ["anim", "Animações"], ["compact", "Modo compacto"]]) {
      const row = el("label", "toggle-row");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = !!ui[key];
      cb.addEventListener("change", () => set({ [key]: cb.checked }));
      row.append(el("span", null, label), cb);
      wrap.append(row);
    }
  }

  render();
  return wrap;
}

// ---------------------------------------------------------------- voz
export function openVoiceSettings(session) {
  const { body, close, onClose } = overlay("Configurações de voz", 500);
  const s = session ? session.settings : loadAudio();
  let meter = null;

  const micSel = el("select");
  const outSel = el("select");
  listDevices().then(({ inputs, outputs }) => {
    micSel.innerHTML =
      '<option value="">Padrão do sistema</option>' +
      inputs.map((d) => `<option value="${d.deviceId}">${d.label || "Microfone"}</option>`).join("");
    outSel.innerHTML =
      '<option value="">Padrão do sistema</option>' +
      outputs.map((d) => `<option value="${d.deviceId}">${d.label || "Saída"}</option>`).join("");
    micSel.value = s.micId || "";
    outSel.value = s.outId || "";
  });

  micSel.addEventListener("change", async () => {
    if (session) await session.setInputDevice(micSel.value);
    else { s.micId = micSel.value; saveAudio(s); }
    restartMeter();
  });
  outSel.addEventListener("change", () => {
    if (session) session.setOutputDevice(outSel.value);
    else { s.outId = outSel.value; saveAudio(s); }
  });

  const mode = el("select");
  mode.innerHTML = `
    <option value="open">Sempre ativo</option>
    <option value="vad">Ativado por voz</option>
    <option value="ptt">Apertar para falar</option>`;
  mode.value = s.mode;

  const threshRow = el("div", "field");
  const thresh = el("input");
  thresh.type = "range"; thresh.min = "0"; thresh.max = "0.4"; thresh.step = "0.005";
  thresh.value = s.threshold;
  threshRow.append(labeled("Sensibilidade da voz", thresh));

  const pttRow = el("div", "field");
  const pttBtn = el("button", "ghost", s.pttKey ? `Tecla: ${s.pttKey}` : "Definir tecla…");
  pttBtn.addEventListener("click", () => {
    pttBtn.textContent = "Pressione uma tecla…";
    const once = (e) => {
      e.preventDefault();
      if (session) session.setPttKey(e.code); else { s.pttKey = e.code; saveAudio(s); }
      pttBtn.textContent = `Tecla: ${e.code}`;
      window.removeEventListener("keydown", once, true);
    };
    window.addEventListener("keydown", once, true);
  });
  pttRow.append(labeled("Tecla de push-to-talk", pttBtn));

  const syncMode = () => {
    threshRow.hidden = mode.value !== "vad";
    pttRow.hidden = mode.value !== "ptt";
  };
  mode.addEventListener("change", () => {
    if (session) session.setMode(mode.value); else { s.mode = mode.value; saveAudio(s); }
    syncMode();
  });
  thresh.addEventListener("input", () => {
    if (session) session.setThreshold(+thresh.value); else { s.threshold = +thresh.value; saveAudio(s); }
  });

  const procBox = el("div", "perm-grid");
  for (const [key, label] of [["ec", "Cancelar eco"], ["ns", "Reduzir ruído"], ["agc", "Ganho automático"]]) {
    const lab = el("label");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = s[key];
    cb.addEventListener("change", () => {
      const patch = { [key]: cb.checked };
      if (session) session.setProcessing(patch); else { Object.assign(s, patch); saveAudio(s); }
    });
    lab.append(cb, el("span", null, label));
    procBox.append(lab);
  }

  const meterWrap = el("div", "meter");
  const meterFill = el("div", "meter-fill");
  const meterMark = el("div", "meter-mark");
  meterWrap.append(meterFill, meterMark);

  function paint(level) {
    meterFill.style.width = Math.min(100, level * 250) + "%";
    meterMark.style.left = Math.min(100, (+thresh.value) * 250) + "%";
    meterFill.style.background =
      mode.value === "vad" && level < +thresh.value ? "var(--text-faint)" : "var(--green)";
  }
  let raf;
  async function restartMeter() {
    stopMeter();
    if (session) {
      const h = (e) => paint(e.detail);
      session.addEventListener("level", h);
      meter = { stop: () => session.removeEventListener("level", h) };
    } else {
      try {
        meter = await createMeter(micSel.value);
        const loop = () => { paint(meter.read()); raf = requestAnimationFrame(loop); };
        loop();
      } catch { /* sem permissão */ }
    }
  }
  function stopMeter() {
    cancelAnimationFrame(raf);
    meter?.stop();
    meter = null;
  }

  body.append(
    labeled("Dispositivo de entrada (microfone)", micSel),
    labeled("Dispositivo de saída", outSel),
    labeled("Modo de transmissão", mode),
    threshRow,
    pttRow,
    el("div", "grp", "Processamento"),
    procBox,
    el("div", "grp", "Nível do microfone"),
    meterWrap,
  );
  const actions = el("div", "modal-actions");
  const done = el("button", "primary", "Fechar");
  done.addEventListener("click", () => { stopMeter(); close(); });
  actions.append(done);
  body.append(actions);

  onClose(stopMeter);
  syncMode();
  restartMeter();
}

// ---------------------------------------------------------------- canal (guild)
export function openChannelSettings(channelId) {
  const g = currentGuild();
  const ch = g?.channels.find((c) => c.id === channelId);
  if (!g || !ch) return;
  const myPerms = guildPermissions(g, state.me.id);
  const canChan = has(myPerms, P.MANAGE_CHANNELS);
  const canRoles = has(myPerms, P.MANAGE_ROLES);

  const { body, close, onClose } = overlay(`Configurações de ${ch.name}`, 560);

  if (canChan) {
    const name = el("input"); name.value = ch.name;
    const topic = el("input"); topic.value = ch.topic || "";
    body.append(labeled("Nome", name));
    if (ch.type === "text") body.append(labeled("Tópico", topic));
    const saveBtn = el("button", "ghost", "Salvar nome / tópico");
    saveBtn.addEventListener("click", async () => {
      try {
        await state.api.patchChannel(ch.id, { name: name.value.trim(), topic: topic.value });
        toast("Canal atualizado", "success");
      } catch (e) { toast(e.message, "error"); }
    });
    body.append(saveBtn);
  }

  if (canRoles) {
    body.append(el("div", "grp", "Permissões do canal (overwrites)"));

    const usedKeys = () => new Set((ch.overwrites || []).map((o) => `${o.target_type}:${o.target_id}`));
    const targets = () => {
      const used = usedKeys();
      const opts = [];
      for (const r of g.roles) if (!used.has(`role:${r.id}`)) opts.push({ t: "role", id: r.id, label: "cargo: " + r.name });
      for (const m of g.members) if (!used.has(`member:${m.id}`)) opts.push({ t: "member", id: m.id, label: "@" + m.username });
      return opts;
    };

    const addSel = el("select");
    const rebuildAdd = () => {
      addSel.innerHTML = '<option value="">+ adicionar cargo/membro…</option>' +
        targets().map((o) => `<option value="${o.t}:${o.id}">${o.label}</option>`).join("");
    };
    rebuildAdd();
    addSel.addEventListener("change", async () => {
      if (!addSel.value) return;
      const [t, id] = addSel.value.split(":");
      try { await state.api.setOverwrite(ch.id, t, +id, 0, 0); }
      catch (e) { toast(e.message, "error"); }
    });
    body.append(addSel);

    const list = el("div", "ow-list");
    body.append(list);

    const renderOverwrites = () => {
      list.replaceChildren();
      rebuildAdd();
      for (const o of ch.overwrites || []) {
        const who = o.target_type === "role"
          ? "cargo: " + (g.roles.find((r) => r.id === o.target_id)?.name || o.target_id)
          : "@" + (g.members.find((m) => m.id === o.target_id)?.username || o.target_id);
        const head = el("div", "tag-row");
        head.append(el("strong", null, who));
        const rm = el("button", "danger-text", "remover");
        rm.addEventListener("click", async () => {
          try { await state.api.clearOverwrite(ch.id, o.target_type, o.target_id); }
          catch (e) { toast(e.message, "error"); }
        });
        head.append(rm);
        list.append(head);

        const grid = el("div", "ow-grid");
        for (const [flag, label] of Object.entries(PERMISSION_LABELS)) {
          const bit = P[flag];
          const rowEl = el("div", "ow-row");
          rowEl.append(el("span", null, label));
          const seg = el("div", "seg-3");
          const states = [
            ["✓", "", () => ({ allow: o.allow | bit, deny: o.deny & ~bit })],
            ["/", "", () => ({ allow: o.allow & ~bit, deny: o.deny & ~bit })],
            ["✕", "deny", () => ({ allow: o.allow & ~bit, deny: o.deny | bit })],
          ];
          const cur = (o.allow & bit) ? 0 : (o.deny & bit) ? 2 : 1;
          states.forEach(([sym, extra, calc], i) => {
            const b = el("button", "seg-btn " + (i === cur ? "on " + extra : ""), sym);
            b.addEventListener("click", async () => {
              const { allow, deny } = calc();
              try { await state.api.setOverwrite(ch.id, o.target_type, o.target_id, allow, deny); }
              catch (e) { toast(e.message, "error"); }
            });
            seg.append(b);
          });
          rowEl.append(seg);
          grid.append(rowEl);
        }
        list.append(grid);
      }
    };
    renderOverwrites();
    const onRefresh = () => {
      const fresh = currentGuild()?.channels.find((c) => c.id === ch.id);
      if (fresh) { ch.overwrites = fresh.overwrites; ch.name = fresh.name; ch.topic = fresh.topic; renderOverwrites(); }
    };
    window.addEventListener("mula:refresh", onRefresh);
    onClose(() => window.removeEventListener("mula:refresh", onRefresh));
  }

  if (canChan) {
    const del = el("button", "danger-text", `Apagar canal ${ch.name}`);
    del.addEventListener("click", async () => {
      if (!confirm(`Apagar #${ch.name}?`)) return;
      try { await state.api.deleteChannel(ch.id); close(); toast("Canal apagado", "success"); }
      catch (e) { toast(e.message, "error"); }
    });
    body.append(el("div", "grp", "Zona de perigo"), del);
  }

  const actions = el("div", "modal-actions");
  const c = el("button", "primary", "Fechar");
  c.addEventListener("click", close);
  actions.append(c);
  body.append(actions);
}
