export type Product = {
  id: number;
  name: string;
  brand: string;
  size_ml: number;
  abv: number;
  price_cents: number;
  image_url?: string;
  is_mini: boolean;
};

export type OrderItem = {
  product_id: number;
  quantity: number;
};

export type Order = {
  id: number;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  age_confirmed: number; // 0/1 boolean
  status: 'pending' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';
  driver_name?: string;
  note?: string;
};
