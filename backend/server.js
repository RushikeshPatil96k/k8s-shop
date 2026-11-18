const express = require("express");
const mysql = require("mysql2/promise");
const os = require("os");

const app = express();
app.use(express.json());

// All settings come from environment variables (ConfigMap + Secret in Kubernetes)
const dbConfig = {
  host: process.env.DB_HOST,
  port: 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
};

let pool;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEED = [
  ["Snake plant", "Nearly impossible to kill. Tolerates skipped waterings and dim corners.", 899, "Low light", "🌿"],
  ["Barrel cactus", "Slow, sculptural and happy on a sunny sill. Water once a month.", 649, "Sun lovers", "🌵"],
  ["Monstera", "Big split leaves that make any room look lived in.", 1499, "Low light", "🪴"],
  ["Desk bonsai", "A tiny juniper for your monitor stand. Trim it when you need a break.", 1899, "Desk size", "🌳"],
  ["Lucky bamboo", "Grows in water alone. Zero soil, zero mess.", 449, "Desk size", "🎍"],
  ["Areca palm", "Soft feathery fronds that fill a bright corner.", 1299, "Sun lovers", "🌴"],
  ["Clover pot", "A cheerful windowsill pot that stays under 20 cm.", 399, "Desk size", "🍀"],
  ["Peace lily", "Droops when thirsty, perks up within hours. Blooms in low light.", 799, "Low light", "🌷"],
];

async function initDb() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      pool = mysql.createPool(dbConfig);
      await pool.query("SELECT 1");
      console.log("Connected to database");
      break;
    } catch (err) {
      console.log(`Database not ready (attempt ${attempt}/30): ${err.code || err.message}`);
      if (attempt === 30) process.exit(1);
      await sleep(5000);
    }
  }

  await pool.query(`CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    price INT NOT NULL,
    category VARCHAR(50),
    icon VARCHAR(10)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    total INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    price INT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  )`);

  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM products");
  if (n === 0) {
    await pool.query(
      "INSERT INTO products (name, description, price, category, icon) VALUES ?",
      [SEED]
    );
    console.log("Seeded products");
  }
}

// Health check: used by the Kubernetes readiness probe
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", pod: os.hostname() });
  } catch {
    res.status(503).json({ status: "db-down", pod: os.hostname() });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM products ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load products" });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    const [[row]] = await pool.query("SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders");
    res.json(row);
  } catch {
    res.status(500).json({ error: "Could not load stats" });
  }
});

app.post("/api/orders", async (req, res) => {
  const { name, email, items } = req.body || {};
  if (!name || !email || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Name, email and at least one item are required" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let total = 0;
    const lines = [];
    for (const it of items) {
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      const [[product]] = await conn.query("SELECT id, price FROM products WHERE id = ?", [it.id]);
      if (!product) throw new Error("Unknown product");
      total += product.price * qty; // price is read from the DB, never trusted from the browser
      lines.push([product.id, qty, product.price]);
    }
    const [result] = await conn.query(
      "INSERT INTO orders (customer_name, email, total) VALUES (?, ?, ?)",
      [name, email, total]
    );
    for (const [pid, qty, price] of lines) {
      await conn.query(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
        [result.insertId, pid, qty, price]
      );
    }
    await conn.commit();
    res.status(201).json({ orderId: result.insertId, total });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(400).json({ error: "Could not place order" });
  } finally {
    conn.release();
  }
});

initDb().then(() => {
  app.listen(5000, () => console.log("Backend listening on 5000"));
});