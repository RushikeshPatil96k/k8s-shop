const $ = (id) => document.getElementById(id);
const inr = (n) => "₹" + n.toLocaleString("en-IN");
const tones = ["#d4e6da", "#f6e7b4", "#d9e3f0", "#efd9d0"];

let products = [];
let filter = "All";
let cart = {}; // { productId: qty }

async function api(path, options) {
  const res = await fetch(path, options);
  const pod = res.headers.get("X-Frontend-Pod");
  if (pod) $("fePod").textContent = pod;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function renderFilters() {
  const cats = ["All", ...new Set(products.map((p) => p.category))];
  $("filters").innerHTML = cats
    .map((c) => `<button class="chip" role="tab" aria-selected="${c === filter}" data-cat="${c}">${c}</button>`)
    .join("");
}

function renderGrid() {
  const list = products.filter((p) => filter === "All" || p.category === filter);
  $("grid").innerHTML = list
    .map(
      (p, i) => `
    <article class="card">
      <div class="art" style="--tone:${tones[i % tones.length]}" aria-hidden="true">${p.icon}</div>
      <div class="body">
        <span class="cat">${p.category}</span>
        <h3>${p.name}</h3>
        <p>${p.description}</p>
        <div class="row">
          <span class="price">${inr(p.price)}</span>
          <button class="add" data-id="${p.id}">Add to cart</button>
        </div>
      </div>
    </article>`
    )
    .join("");
}

function renderCart() {
  const ids = Object.keys(cart);
  $("cartCount").textContent = ids.reduce((s, id) => s + cart[id], 0);
  let total = 0;
  $("cartItems").innerHTML = ids.length
    ? ids
        .map((id) => {
          const p = products.find((x) => x.id == id);
          total += p.price * cart[id];
          return `<div class="line">
            <span class="ic">${p.icon}</span>
            <span class="nm">${p.name}<br><small>${inr(p.price)}</small></span>
            <span class="qty"><button data-dec="${id}" aria-label="Remove one">−</button> ${cart[id]} <button data-inc="${id}" aria-label="Add one">+</button></span>
          </div>`;
        })
        .join("")
    : `<p class="muted">Your cart is empty. Add a plant to get started.</p>`;
  $("cartTotal").textContent = inr(total);
}

function toggleDrawer(open) {
  $("drawer").classList.toggle("on", open);
  $("scrim").classList.toggle("on", open);
  $("drawer").setAttribute("aria-hidden", String(!open));
}

async function refreshCluster() {
  try {
    const h = await api("/api/health");
    $("bePod").textContent = h.pod;
    const s = await api("/api/stats");
    $("orders").textContent = s.orders;
  } catch {
    $("bePod").textContent = "unreachable";
  }
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset.cat) { filter = t.dataset.cat; renderFilters(); renderGrid(); }
  if (t.dataset.id) { cart[t.dataset.id] = (cart[t.dataset.id] || 0) + 1; renderCart(); }
  if (t.dataset.inc) { cart[t.dataset.inc]++; renderCart(); }
  if (t.dataset.dec) { if (--cart[t.dataset.dec] <= 0) delete cart[t.dataset.dec]; renderCart(); }
});
$("openCart").onclick = () => toggleDrawer(true);
$("closeCart").onclick = () => toggleDrawer(false);
$("scrim").onclick = () => toggleDrawer(false);

$("checkout").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("msg");
  msg.className = "";
  const items = Object.entries(cart).map(([id, qty]) => ({ id: Number(id), qty }));
  if (!items.length) { msg.className = "err"; msg.textContent = "Add at least one plant first."; return; }
  const form = new FormData(e.target);
  try {
    const r = await api("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), email: form.get("email"), items }),
    });
    msg.textContent = `Order #${r.orderId} placed. Total ${inr(r.total)}.`;
    cart = {};
    renderCart();
    e.target.reset();
    refreshCluster();
  } catch (err) {
    msg.className = "err";
    msg.textContent = err.message;
  }
});

(async function init() {
  try {
    products = await api("/api/products");
    renderFilters();
    renderGrid();
  } catch {
    $("grid").innerHTML = `<p class="muted">The shop could not reach its backend. Check that the backend pods are running.</p>`;
  }
  renderCart();
  refreshCluster();
  setInterval(refreshCluster, 5000);
})();