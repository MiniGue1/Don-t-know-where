// Leaderboard: you vs. friends whose cards you've added. No server, no accounts.

import { $, esc, toast, store, views, showView, shareStuff, kcalFor } from "../app.js";
import { newIdentity, myStats, encodeCard, decodeCard, extractCode, rankBoard, BOARDS, AVATARS } from "../leaderboard.js";

let board = "weekKm";

export function identity() {
  let id = store.getIdentity();
  if (!id) {
    id = newIdentity();
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
  $("#avatar-btn").textContent = id.avatar;
  if (document.activeElement !== $("#nickname")) $("#nickname").value = id.name;
  $("#board-picker").innerHTML = Object.values(BOARDS)
    .map((b) => `<button type="button" role="radio" data-board="${b.id}" aria-checked="${b.id === board}">${b.label}</button>`)
    .join("");
  $("#board-hint").textContent = `${BOARDS[board].unit} · ${BOARDS[board].hint}`;
  const friends = store.getFriends();
  const rows = rankBoard(board, me(), friends);
  const medal = (r) => ["🥇", "🥈", "🥉"][r - 1] || r;
  $("#board").innerHTML =
    rows
      .map(
        (r) => `<div class="board-row${r.isMe ? " me" : ""}">
        <span class="rank">${medal(r.rank)}</span>
        <span class="av">${esc(r.avatar)}</span>
        <span class="nm">${esc(r.name)}${r.isMe ? " (you)" : ""}</span>
        <span class="val">${esc(String(r.value))}</span>
        ${r.isMe ? "<span></span>" : `<button type="button" class="x" data-remove="${esc(r.id)}" aria-label="Remove ${esc(r.name)}">✕</button>`}
      </div>`
      )
      .join("") + (friends.length ? "" : `<div class="empty">Just you so far. Share your card with friends — when they send theirs back, they show up here.</div>`);
}

$("#board-picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-board]");
  if (!b) return;
  board = b.dataset.board;
  render();
});

$("#board").addEventListener("click", (e) => {
  const x = e.target.closest("[data-remove]");
  if (x && confirm("Remove this friend from your leaderboard?")) {
    store.removeFriend(x.dataset.remove);
    render();
  }
});

$("#avatar-btn").addEventListener("click", () => {
  const id = identity();
  id.avatar = AVATARS[(AVATARS.indexOf(id.avatar) + 1) % AVATARS.length];
  store.saveIdentity(id);
  render();
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
    title: "My Don't Know Where card",
    text: `${id.avatar} ${id.name} challenges you! Open this to add me to your leaderboard:`,
    url: cardLink(),
  });
  if (res === "copied") toast("Link copied — send it to a friend");
  else if (res === "failed") toast("Couldn't share — copy the code from the address bar instead");
});

$("#add-friend-btn").addEventListener("click", () => {
  $("#add-friend-panel").hidden = !$("#add-friend-panel").hidden;
});

export function addFriendFromCode(text, ask = true) {
  const code = extractCode(text);
  if (!code) return toast("That doesn't look like a friend's card link.");
  try {
    const card = decodeCard(code);
    if (card.id === identity().id) return toast("That's your own card 🙂");
    const exists = store.getFriends().some((f) => f.id === card.id);
    if (ask && !confirm(`${exists ? "Update" : "Add"} ${card.avatar} ${card.name} ${exists ? "on" : "to"} your leaderboard?`)) return;
    store.upsertFriend(card);
    toast(`${card.name} ${exists ? "updated" : "added"}!`);
    showView("ranks");
  } catch {
    toast("That card link is broken or incomplete.");
  }
}

$("#friend-add").addEventListener("click", () => {
  addFriendFromCode($("#friend-code").value, false);
  $("#friend-code").value = "";
});

views.ranks = { show: render };
