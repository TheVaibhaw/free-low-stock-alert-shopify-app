import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const available = payload.available;
  const inventoryItemId = String(payload.inventory_item_id);

  // available null aata hai jab item track nahi ho raha
  if (available === null || available === undefined) {
    return new Response();
  }

  const settings = await db.settings.findUnique({ where: { shop } });
  if (settings && !settings.enabled) {
    return new Response();
  }
  const threshold = settings?.threshold ?? 5;

  if (available > threshold) {
    return new Response();
  }

  // Product ka naam aur SKU nikalo
  let productTitle = "Unknown product";
  let sku = "";
  if (admin) {
    const response = await admin.graphql(
      `#graphql
      query getItem($id: ID!) {
        inventoryItem(id: $id) {
          sku
          variant {
            displayName
          }
        }
      }`,
      { variables: { id: `gid://shopify/InventoryItem/${inventoryItemId}` } },
    );
    const { data } = await response.json();
    productTitle = data?.inventoryItem?.variant?.displayName ?? productTitle;
    sku = data?.inventoryItem?.sku ?? "";
  }

  // Same item ka alert pichhle 24 ghante mein gaya ho to dobara mat bhejo
  const recentAlert = await db.alertLog.findFirst({
    where: {
      shop,
      inventoryItemId,
      sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (recentAlert) {
    return new Response();
  }

  console.log(`LOW STOCK: ${productTitle} (SKU: ${sku}) - only ${available} left`);

  // TODO: yahan email bhejna hai (Step 7)

  await db.alertLog.create({
    data: { shop, inventoryItemId, quantity: available },
  });

  return new Response();
};
