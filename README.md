# Low Stock Alert - Shopify App

A Shopify app (React Router template) that sends an alert when a product's stock drops below a threshold.

## Setup Guide

### Step 0: Prerequisites
- Create a Shopify Partner account at https://partners.shopify.com
- From the Partner dashboard, create a **Development store** and add a few test products
- Install Git

---

### Step 1: Node setup
The Shopify CLI is installed under Node 22, so use Node 22 everywhere.
```bash
nvm install 22
nvm use 22
nvm alias default 22
```
> Run `nvm use 22` in **every new terminal**, otherwise you get `shopify: command not found`.

---

### Step 2: Create the app
```bash
npm init @shopify/app@latest
```
- Ok to proceed? (y) → `y`
- For your React Router template, which language do you want? → `JavaScript`
- App name → your app name

```bash
cd <app-name>
shopify app dev        # or: npm run dev
```
Log in to Partners when asked and select your dev store.

---

### Step 3: Set access scopes
In `shopify.app.toml`:
```toml
[access_scopes]
scopes = "read_products,read_inventory,read_locations,write_products"
```
Restart `shopify app dev`; the scopes are granted automatically in dev.
(`npm run deploy` is only needed for production.)

---

### Step 4: Add database models and run the migration
1. Stop the dev server (press `q`).
2. Add these models at the end of `prisma/schema.prisma`:

```prisma
model Settings {
  id         Int      @id @default(autoincrement())
  shop       String   @unique
  threshold  Int      @default(5)
  alertEmail String?
  enabled    Boolean  @default(true)
  updatedAt  DateTime @updatedAt
}

model AlertLog {
  id              Int      @id @default(autoincrement())
  shop            String
  inventoryItemId String
  quantity        Int
  sentAt          DateTime @default(now())

  @@index([shop, inventoryItemId])
}
```

3. Run the migration:
```bash
npx prisma migrate dev --name add_alert_models
```
The output should say "Applying migration" and a new folder should appear in `prisma/migrations`.

---

### Step 5: Subscribe to the inventory webhook
In `shopify.app.toml`, under the existing `[webhooks]` subscriptions:
```toml
  [[webhooks.subscriptions]]
  uri = "/webhooks/inventory/update"
  topics = [ "inventory_levels/update" ]
```
Restart `shopify app dev` after changing the toml file.

---

### Step 6: Create the webhook route
Create `app/routes/webhooks.inventory.update.jsx`:

```jsx
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

  // TODO: yahan email bhejna hai (Step 9)

  await db.alertLog.create({
    data: { shop, inventoryItemId, quantity: available },
  });

  return new Response();
};
```

> Do not copy `webhooks.app.uninstalled.jsx` as-is: it deletes sessions and would log you out on every stock update.

---

### Step 7: Open the app in the store
In the terminal running `shopify app dev`, press `p`. This opens and installs the app on the correct dev store.

---

### Step 8: Test the webhook

#### 8a. Local test (optional, only checks the route)
Keep `shopify app dev` running. Open a **new terminal**:
```bash
nvm use 22
shopify app webhook trigger --topic inventory_levels/update --api-version 2027-01 --delivery-method http --address http://localhost:<PORT>/webhooks/inventory/update
```
- `<PORT>` comes from the dev terminal line `➜  Local:   http://localhost:XXXXX/`. It **changes on every restart**.
- Expected: `✅ Success! Localhost delivery successful.` and, in the dev terminal, `Received INVENTORY_LEVELS_UPDATE webhook`.
- `LOW STOCK` is **not** printed here because the payload is fake.

#### 8b. Real test
1. In the store admin, open **Products** and pick a product.
2. Make sure **Inventory tracked** is ON.
3. In the **Available** column, set the quantity **below the threshold (5)** and to a value **different from the current one**, for example 3.
4. Click **Save** and wait 10–60 seconds.
5. Check the dev terminal:
```
Received INVENTORY_LEVELS_UPDATE webhook for <your-store>.myshopify.com
LOW STOCK: The Minimal Snowboard - Default Title (SKU: ) - only 3 left
```

**Notes**
- An empty `SKU:` just means the product has no SKU.
- The same product only alerts once per 24 hours (AlertLog check). Use a different product to test again.
- If nothing arrives: stop dev, run `shopify app dev --reset`, select the same org/app/store, press `p`, and test again.

---

### Step 9: Send the email (Resend) — TODO
1. Create a free account at https://resend.com and generate an API key.
2. Install the package:
```bash
npm install resend
```
3. Add to `.env`:
```
RESEND_API_KEY=re_xxxxxxxx
ALERT_TO_EMAIL=your-resend-account-email@example.com
```
In test mode, Resend only delivers to the email you signed up with.

4. At the top of `webhooks.inventory.update.jsx`:
```jsx
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
```
5. Replace the `// TODO: yahan email bhejna hai` line with:
```jsx
  await resend.emails.send({
    from: "Low Stock Alert <onboarding@resend.dev>",
    to: settings?.alertEmail || process.env.ALERT_TO_EMAIL,
    subject: `Low stock: ${productTitle}`,
    html: `<p><b>${productTitle}</b> (SKU: ${sku || "-"}) mein sirf <b>${available}</b> bache hain.</p>`,
  });
```
6. Restart `shopify app dev` (so `.env` is loaded), lower another product's stock, and check your inbox and spam folder.

---

### Step 10: Settings page — TODO
`app/routes/app.settings.jsx`: a form for threshold, alert email and enabled. Read with `loader` and save with `action` (`db.settings.upsert`).

### Step 11: Dashboard — TODO
`app/routes/app._index.jsx`: list low stock products (GraphQL `productVariants` with `inventoryQuantity`).

### Step 12: Production — TODO
- GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact`
- Use Postgres instead of SQLite
- Host on Fly.io / Render / Railway and set env vars (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL`, `RESEND_API_KEY`)
- `npm run deploy`, then submit for App Store review

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `shopify: command not found` | Run `nvm use 22` in that terminal |
| `ECONNREFUSED` on webhook trigger | `shopify app dev` is not running, or the port is wrong |
| Migration says "Already in sync" | The models were not added to `schema.prisma` yet |
| No webhook after changing stock | Inventory tracked OFF, value unchanged, or the 24h alert limit; try `shopify app dev --reset` |
| Yellow "Future Flag Warning" lines | Informational only, ignore them |

---

# Template documentation

# Shopify App Template - React Router

This is a template for building a [Shopify app](https://shopify.dev/docs/apps/getting-started) using [React Router](https://reactrouter.com/). It was forked from the [Shopify Remix app template](https://github.com/Shopify/shopify-app-template-remix) and converted to React Router.

Rather than cloning this repo, follow the [Quick Start steps](https://github.com/Shopify/shopify-app-template-react-router#quick-start).

Visit the [`shopify.dev` documentation](https://shopify.dev/docs/api/shopify-app-react-router) for more details on the React Router app package.

## Upgrading from Remix

If you have an existing Remix app that you want to upgrade to React Router, please follow the [upgrade guide](https://github.com/Shopify/shopify-app-template-react-router/wiki/Upgrading-from-Remix). Otherwise, please follow the quick start guide below.

## Quick start

### Prerequisites

Before you begin, you'll need to [download and install the Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) if you haven't already.

### Setup

```shell
shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router
```

### Local Development

```shell
shopify app dev
```

Press P to open the URL to your app. Once you click install, you can start development.

Local development is powered by [the Shopify CLI](https://shopify.dev/docs/apps/tools/cli). It logs into your account, connects to an app, provides environment variables, updates remote config, creates a tunnel and provides commands to generate extensions.

### Authenticating and querying data

To authenticate and query data you can use the `shopify` const that is exported from `/app/shopify.server.js`:

```js
export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 25) {
        nodes {
          title
          description
        }
      }
    }`);

  const {
    data: {
      products: { nodes },
    },
  } = await response.json();

  return nodes;
}
```

This template comes pre-configured with examples of:

1. Setting up your Shopify app in [/app/shopify.server.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/shopify.server.ts)
2. Querying data using Graphql. Please see: [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx).
3. Responding to webhooks. Please see [/app/routes/webhooks.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/webhooks.app.uninstalled.tsx).
4. Using metafields, metaobjects, and declarative custom data definitions. Please see [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx) and [shopify.app.toml](https://github.com/Shopify/shopify-app-template-react-router/blob/main/shopify.app.toml).

Please read the [documentation for @shopify/shopify-app-react-router](https://shopify.dev/docs/api/shopify-app-react-router) to see what other API's are available.

## Resources

React Router:

- [React Router docs](https://reactrouter.com/home)

Shopify:

- [Intro to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify App Bridge](https://shopify.dev/docs/api/app-bridge-library).
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components).
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)