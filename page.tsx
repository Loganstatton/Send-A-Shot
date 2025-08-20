'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Item = { product_id: number; name: string; brand: string; size_ml: number; abv: number; price_cents: number; quantity: number };

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const tick = () => fetch(`/api/orders/${id}`).then(r => r.json()).then(setData);
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [id]);

  if (!data) return <div className="card">Loading…</div>;

  const { order, items } = data as { order: any; items: Item[] };

  return (
    <div className="space-y-4">
      <div className="card">
        <h1 className="text-2xl font-semibold">Order #{order.id}</h1>
        <p className="text-neutral-400">Placed at {new Date(order.created_at).toLocaleString()}</p>
        <div className="mt-2">
          <span className="badge">Status: <strong className="ml-1 capitalize">{order.status}</strong></span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card md:col-span-2">
          <h2 className="font-semibold">Items</h2>
          <ul className="mt-2 space-y-2">
            {items.map((it, idx) => (
              <li key={idx} className="flex items-center justify-between">
                <div>{it.brand} {it.name} × {it.quantity}</div>
                <div>${((it.price_cents * it.quantity)/100).toFixed(2)}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2 className="font-semibold">Delivery</h2>
          <p className="text-sm text-neutral-300">{order.customer_name} • {order.customer_phone}</p>
          <p className="text-sm text-neutral-300 mt-1">{order.address_line1}{order.address_line2 ? ', ' + order.address_line2 : ''}</p>
          <p className="text-sm text-neutral-300">{order.city}, {order.state} {order.zip}</p>
          {order.driver_name && <p className="text-sm text-neutral-300 mt-2">Driver: {order.driver_name}</p>}
        </div>
      </div>
    </div>
  );
}
