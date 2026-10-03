// Leaderboard: you vs. friends whose cards you've added. No server, no accounts.

import { $, esc, toast, store, views, showView, shareStuff, kcalFor } from "../app.js";
import { newIdentity, myStats, encodeCard, decodeCard, extractCode, rankBoard, BOARDS, initials, colorFor } from "../leaderboard.js";
import { icon } from "../icons.js";
import { t, getLang } from "../i18n.js";

let board = "weekKm";

export function identity() {
  let id = store.getIdentity();
  if (id && !/^#[0-9a-f]{6}$/i.test(id.avatar)) {
    id.avatar = colorFor(id.id); // older versions stored an emoji
    store.saveIdentity(id);
  }
  if (!id) {
    id = newIdentity(Math.random, getLang());
    store.saveIdentity(id);
  }
  return id;
}

function me() {
  const id = identity();
  return { ...id, stats: myStats(store.getHistory(), kcalFor), updatedAt: Date.now() };
}

export function cardLink() {
  const m = me();
  const base = location.href.split("#")[0];
  return `${base}#friend=${encodeCard(m, m.stats)}`;
}

function render() {
  const id = identity();
  $("#my-avatar").textContent = initials(id.name);
  $("#my-avatar").style.background = id.avatar;
  if (document.activeElement !== $("#nickname")) $("#nickname").value = id.name;
  $("#board-picker").innerHTML = Object.values(BOARDS)
    .map((b) => `<button type="button" role="radio" data-board="${b.id}" aria-checked="${b.id === board}">${esc(t(`board.${b.id}`))}</button>`)
    .join("");
  const friends = store.getFriends();
  const rows = rankBoard(board, me(), friends);
  $("#board").innerHTML =
    rows
      .map(
        (r) => `<div class="board-row${r.isMe ? " me" : ""}${r.rank === 1 ? " first" : ""}">
        <span class="rank">${r.rank === 1 ? icon("trophy") : r.rank}</span>
        <span class="avatar av" style="background:${esc(r.avatar)}">${esc(initials(r.name))}</span>
        <span class="nm">${esc(r.name)}</span>
        <span class="val">${esc(String(r.value))} <small class="hint">${esc(t(`unit.${board}`))}</small></span>
        ${r.isMe ? "<span></span>" : `<button type="button" class="x" data-remove="${esc(r.id)}" aria-label="${esc(t("ranks.remove", { name: r.name }))}">${icon("x")}</button>`}
      </div>`
      )
      .join("") + (friends.length ? "" : `<div class="empty">${esc(t("ranks.empty"))}</div>`);
}

$("#board-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-board]");
  if (!b) return;
  board = b.dataset.board;
  render();
});

$("#board").addEventListener("click", (e) => {
  const x = e.target.closest("[data-remove]");
  if (x && confirm(t("ranks.removeQ"))) {
    store.removeFriend(x.dataset.remove);
    render();
  }
});


$("#nickname").addEventListener("change", (e) => {
  const id = identity();
  id.name = e.target.value.trim().slice(0, 32) || id.name;
  store.saveIdentity(id);
  render();
});

$("#share-card-btn").addEventListener("click", async () => {
  const id = identity();
  const res = await shareStuff({
    title: t("ranks.shareTitle"),
    text: t("ranks.shareText", { name: id.name }),
    url: cardLink(),
  });
  if (res === "copied") toast(t("ranks.copied"));
  else if (res === "failed") toast(t("ranks.shareFailed"));
});

$("#add-friend-btn").addEventListener("click", () => {
  $("#add-friend-panel").hidden = !$("#add-friend-panel").hidden;
});

export function addFriendFromCode(text, ask = true) {
  const code = extractCode(text);
  if (!code) return toast(t("ranks.notLink"));
  try {
    const card = decodeCard(code);
    if (card.id === identity().id) return toast(t("ranks.own"));
    const exists = store.getFriends().some((f) => f.id === card.id);
    if (ask && !confirm(t(exists ? "ranks.updateQ" : "ranks.addQ", { name: card.name }))) return;
    store.upsertFriend(card);
    toast(t(exists ? "ranks.updated" : "ranks.added", { name: card.name }));
    showView("ranks");
  } catch {
    toast(t("ranks.broken"));
  }
}

$("#friend-add").addEventListener("click", () => {
  addFriendFromCode($("#friend-code").value, false);
  $("#friend-code").value = "";
});

views.ranks = { show: render };
