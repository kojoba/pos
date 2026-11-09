import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATABASE_DIR
  ? path.resolve(process.env.DATABASE_DIR)
  : path.resolve(here, '../data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(path.join(dataDir, 'daddys-pizza.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager','worker','rider')),
  branch_id INTEGER REFERENCES branches(id),
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
CREATE TABLE IF NOT EXISTS branch_inventory (
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  on_hand INTEGER NOT NULL DEFAULT 0 CHECK(on_hand >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(branch_id,product_id)
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  sms_marketing_consent INTEGER NOT NULL DEFAULT 0,
  email_marketing_consent INTEGER NOT NULL DEFAULT 0,
  consent_source TEXT NOT NULL DEFAULT '',
  consent_updated_at TEXT,
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
  branch_id INTEGER REFERENCES branches(id),
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
  branch_id INTEGER REFERENCES branches(id),
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
CREATE TABLE IF NOT EXISTS warehouse_inventory (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS warehouse_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  requested_by_id INTEGER NOT NULL REFERENCES users(id),
  requested_by_name TEXT NOT NULL,
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  recipient_name TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id),
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','dispatched','received')),
  approved_by_id INTEGER REFERENCES users(id),
  approved_by_name TEXT DEFAULT '',
  approved_at TEXT,
  dispatched_by_id INTEGER REFERENCES users(id),
  dispatched_by_name TEXT DEFAULT '',
  dispatched_at TEXT,
  received_quantity INTEGER,
  received_by_id INTEGER REFERENCES users(id),
  received_by_name TEXT DEFAULT '',
  received_confirmed_by_id INTEGER REFERENCES users(id),
  received_confirmed_by_name TEXT DEFAULT '',
  received_at TEXT,
  receive_note TEXT DEFAULT '',
  rejected_by_id INTEGER REFERENCES users(id),
  rejected_by_name TEXT DEFAULT '',
  rejected_at TEXT,
  legacy_stock_request_id INTEGER UNIQUE REFERENCES stock_requests(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customer_broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK(channel IN ('email','sms')),
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  sent_by_id INTEGER NOT NULL REFERENCES users(id),
  sent_by_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','sent','partial','failed')),
  total_recipients INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  provider_batch_id TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS customer_broadcast_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id INTEGER NOT NULL REFERENCES customer_broadcasts(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','delivered','failed')),
  provider_message_id TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  sent_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS customer_consent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('email','sms')),
  consent_given INTEGER NOT NULL CHECK(consent_given IN (0,1)),
  source TEXT NOT NULL DEFAULT '',
  changed_by_id INTEGER REFERENCES users(id),
  changed_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customer_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  food_rating INTEGER NOT NULL CHECK(food_rating BETWEEN 1 AND 5),
  service_rating INTEGER NOT NULL CHECK(service_rating BETWEEN 1 AND 5),
  delivery_rating INTEGER CHECK(delivery_rating IS NULL OR delivery_rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewed','follow_up')),
  reviewed_by_id INTEGER REFERENCES users(id),
  reviewed_by_name TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
ensureColumn('users', 'branch_id', 'INTEGER REFERENCES branches(id)');
ensureColumn('orders', 'branch_id', 'INTEGER REFERENCES branches(id)');
ensureColumn('stock_movements', 'branch_id', 'INTEGER REFERENCES branches(id)');
ensureColumn('warehouse_requests', 'branch_id', 'INTEGER REFERENCES branches(id)');
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
ensureColumn('stock_movements', 'location', `TEXT NOT NULL DEFAULT 'restaurant'`);
ensureColumn('customers', 'email', `TEXT NOT NULL DEFAULT ''`);
ensureColumn('customers', 'sms_marketing_consent', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('customers', 'email_marketing_consent', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('customers', 'consent_source', `TEXT NOT NULL DEFAULT ''`);
ensureColumn('customers', 'consent_updated_at', 'TEXT');
db.prepare(`INSERT OR IGNORE INTO branches(name,code,address) VALUES('Main Branch','MAIN','')`).run();
const defaultBranchId=db.prepare(`SELECT id FROM branches WHERE code='MAIN'`).get().id;
db.prepare('UPDATE users SET branch_id=? WHERE branch_id IS NULL AND role!=\'manager\'').run(defaultBranchId);
db.prepare('UPDATE orders SET branch_id=? WHERE branch_id IS NULL').run(defaultBranchId);
db.prepare('UPDATE warehouse_requests SET branch_id=? WHERE branch_id IS NULL').run(defaultBranchId);
db.prepare(`UPDATE stock_movements SET branch_id=(SELECT o.branch_id FROM orders o WHERE o.ref=stock_movements.reference) WHERE branch_id IS NULL AND movement_type='sale'`).run();
db.prepare(`UPDATE customers SET email=COALESCE((SELECT lower(trim(o.customer_email)) FROM orders o
  WHERE o.customer_id=customers.id AND trim(COALESCE(o.customer_email,''))!='' ORDER BY o.id DESC LIMIT 1),'')
  WHERE trim(COALESCE(email,''))=''`).run();
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

db.prepare('INSERT OR IGNORE INTO warehouse_inventory(product_id,quantity) SELECT id,0 FROM products').run();
db.prepare(`INSERT OR IGNORE INTO branch_inventory(branch_id,product_id,on_hand,reserved)
  SELECT ?,id,stock,reserved FROM products`).run(defaultBranchId);
db.prepare(`INSERT OR IGNORE INTO branch_inventory(branch_id,product_id,on_hand,reserved)
  SELECT b.id,p.id,0,0 FROM branches b CROSS JOIN products p`).run();
db.prepare(`INSERT OR IGNORE INTO warehouse_requests(
  reference,product_id,product_name,quantity,requested_by_id,requested_by_name,recipient_id,recipient_name,branch_id,note,status,legacy_stock_request_id,created_at
)
SELECT 'WR-LEGACY-' || s.id,s.product_id,s.product_name,s.quantity,s.requested_by_id,s.requested_by_name,
  COALESCE((SELECT u.id FROM users u WHERE lower(trim(u.name))=lower(trim(s.received_by)) LIMIT 1),s.requested_by_id),
  s.received_by,COALESCE((SELECT u.branch_id FROM users u WHERE lower(trim(u.name))=lower(trim(s.received_by)) LIMIT 1),?),s.note,'pending',s.id,s.created_at
FROM stock_requests s WHERE s.status='pending'`).run(defaultBranchId);
