import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(path.join(dataDir, 'daddys-pizza.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager','worker','rider')),
  phone TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Food',
  price_pesewas INTEGER NOT NULL CHECK(price_pesewas >= 0),
  stock INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  total_spent_pesewas INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  last_visit TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  total_pesewas INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT DEFAULT '',
  payment_reference TEXT,
  payment_message TEXT DEFAULT '',
  paid_at TEXT,
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  cashier_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price_pesewas INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0)
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  reference TEXT DEFAULT '',
  performed_by TEXT NOT NULL,
  received_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  requested_by_id INTEGER NOT NULL REFERENCES users(id),
  requested_by_name TEXT NOT NULL,
  received_by TEXT NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  rider_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','picked_up','en_route','delivered')),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  picked_up_at TEXT,
  delivered_at TEXT
);
`);

// Keep existing local databases compatible as payment fields are added.
const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};
ensureColumn('products', 'reserved', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'payment_reference', 'TEXT');
ensureColumn('orders', 'payment_message', `TEXT DEFAULT ''`);
ensureColumn('orders', 'paid_at', 'TEXT');
ensureColumn('orders', 'fulfillment_type', `TEXT NOT NULL DEFAULT 'pickup'`);
ensureColumn('orders', 'delivery_address', `TEXT DEFAULT ''`);
ensureColumn('orders', 'delivery_instructions', `TEXT DEFAULT ''`);
ensureColumn('orders', 'delivery_fee_pesewas', `INTEGER NOT NULL DEFAULT 0`);
ensureColumn('orders', 'cash_collected_by_id', 'INTEGER');
ensureColumn('orders', 'cash_collected_by_name', `TEXT DEFAULT ''`);
ensureColumn('orders', 'customer_email', `TEXT DEFAULT ''`);
ensureColumn('orders', 'delivery_code_hash', 'TEXT');
ensureColumn('orders', 'delivery_code_expires_at', 'TEXT');
ensureColumn('orders', 'delivery_code_sent_at', 'TEXT');
ensureColumn('orders', 'delivery_code_attempts', `INTEGER NOT NULL DEFAULT 0`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_reference ON orders(payment_reference) WHERE payment_reference IS NOT NULL`);

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0) {
  const username = (process.env.ADMIN_USERNAME || 'manager').trim().toLowerCase();
  const name = process.env.ADMIN_NAME || 'Restaurant Manager';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)').run(username, name, hash, 'manager');
}
const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
if (productCount === 0) {
  const add = db.prepare('INSERT INTO products (name, category, price_pesewas, stock, reorder_level) VALUES (?, ?, ?, ?, ?)');
  const seed = db.transaction(() => [
    ['Chicken Burger','Burgers',2500,50,10], ['Beef Pizza','Pizza',4500,30,8], ['French Fries','Sides',1200,100,15],
    ['Coca Cola','Drinks',800,200,24], ['Grilled Chicken','Meals',3800,25,8], ['Rice & Beans','Meals',1800,60,10],
    ['Milkshake','Drinks',1500,40,10], ['Chicken Wings','Sides',3000,35,10],
  ].forEach(row => add.run(...row)));
  seed();
}
