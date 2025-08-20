import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Product } from './types';

const dbFile = path.join(process.cwd(), 'data', 'app.db');
const dir = path.dirname(dbFile);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(dbFile);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  size_ml INTEGER NOT NULL,
  abv REAL NOT NULL,
  price_cents INTEGER NOT NULL,
  image_url TEXT,
  is_mini INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  age_confirmed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  driver_name TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

// Seed if empty
const count = db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number };
if ((count as any).c === 0) {
  const seed: Product[] = [
    { id: 1, name: 'Vodka Mini', brand: 'Grey Goose', size_ml: 50, abv: 40, price_cents: 599, image_url: 'https://images.unsplash.com/photo-1603398749947-8063a3003736', is_mini: true },
    { id: 2, name: 'Tequila Blanco Mini', brand: 'Patrón', size_ml: 50, abv: 40, price_cents: 699, image_url: 'https://images.unsplash.com/photo-1627706492322-1b2669ad49d8', is_mini: true },
    { id: 3, name: 'Whiskey Mini', brand: 'Jack Daniel\'s', size_ml: 50, abv: 40, price_cents: 499, image_url: 'https://images.unsplash.com/photo-1541976076758-347942db197f', is_mini: true },
    { id: 4, name: 'Rum Mini', brand: 'Bacardi', size_ml: 50, abv: 37.5, price_cents: 399, image_url: 'https://images.unsplash.com/photo-1614707267233-827bd4d8a4bb', is_mini: true },
    { id: 5, name: 'Shot Glass', brand: 'Glassware Co', size_ml: 60, abv: 0, price_cents: 299, image_url: 'https://images.unsplash.com/photo-1544145945-f90425340c0a', is_mini: false },
  ];
  const insert = db.prepare(`INSERT INTO products (id, name, brand, size_ml, abv, price_cents, image_url, is_mini) 
    VALUES (@id, @name, @brand, @size_ml, @abv, @price_cents, @image_url, @is_mini)`);
  const tx = db.transaction((items: Product[]) => {
    for (const it of items) insert.run(it as any);
  });
  tx(seed);
}

export function money(cents: number) {
  return `$${(cents/100).toFixed(2)}`;
}
