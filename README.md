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

## Shopify Dev MCP

This template is configured with the Shopify Dev MCP. This instructs [Cursor](https://cursor.com/), [GitHub Copilot](https://github.com/features/copilot) and [Claude Code](https://claude.com/product/claude-code) and [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) to use the Shopify Dev MCP.

For more information on the Shopify Dev MCP please read [the documentation](https://shopify.dev/docs/apps/build/devmcp).

## Deployment

### Application Storage

This template uses [Prisma](https://www.prisma.io/) to store session data, by default using an [SQLite](https://www.sqlite.org/index.html) database.
The database is defined as a Prisma schema in `prisma/schema.prisma`.

This use of SQLite works in production if your app runs as a single instance.
The database that works best for you depends on the data your app needs and how it is queried.
Here’s a short list of databases providers that provide a free tier to get started:

| Database   | Type             | Hosters                                                                                                                                                                                                                                    |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MySQL      | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mysql), [Planet Scale](https://planetscale.com/), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/mysql) |
| PostgreSQL | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres)                                   |
| Redis      | Key-value        | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-redis), [Amazon MemoryDB](https://aws.amazon.com/memorydb/)                                                                                                        |
| MongoDB    | NoSQL / Document | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mongodb), [MongoDB Atlas](https://www.mongodb.com/atlas/database)                                                                                                  |

To use one of these, you can use a different [datasource provider](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#datasource) in your `schema.prisma` file, or a different [SessionStorage adapter package](https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/docs/guides/session-storage.md).

### Build

Build the app by running the command below with the package manager of your choice:

Using yarn:

```shell
yarn build
```

Using npm:

```shell
npm run build
```

Using pnpm:

```shell
pnpm run build
```

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/launch/deployment) to host it externally. From there, you have a few options:

- [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run): This tutorial is written specifically for this example repo, and is compatible with the extended steps included in the subsequent [**Build your app**](tutorial) in the **Getting started** docs. It is the most detailed tutorial for taking a React Router-based Shopify app and deploying it to production. It includes configuring permissions and secrets, setting up a production database, and even hosting your apps behind a load balancer across multiple regions.
- [Fly.io](https://fly.io/docs/js/shopify/): Leverages the Fly.io CLI to quickly launch Shopify apps to a single machine.
- [Render](https://render.com/docs/deploy-shopify-app): This tutorial guides you through using Docker to deploy and install apps on a Dev store.
- [Manual deployment guide](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service): This resource provides general guidance on the requirements of deployment including environment variables, secrets, and persistent data.

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.

## Gotchas / Troubleshooting

### Database tables don't exist

If you get an error like:

```
The table `main.Session` does not exist in the current database.
```

Create the database for Prisma. Run the `setup` script in `package.json` using `npm`, `yarn` or `pnpm`.

### Navigating/redirecting breaks an embedded app

Embedded apps must maintain the user session, which can be tricky inside an iFrame. To avoid issues:

1. Use `Link` from `react-router` or `@shopify/polaris`. Do not use `<a>`.
2. Use `redirect` returned from `authenticate.admin`. Do not use `redirect` from `react-router`
3. Use `useSubmit` from `react-router`.

This only applies if your app is embedded, which it will be by default.

### Webhooks: shop-specific webhook subscriptions aren't updated

If you are registering webhooks in the `afterAuth` hook, using `shopify.registerWebhooks`, you may find that your subscriptions aren't being updated.

Instead of using the `afterAuth` hook declare app-specific webhooks in the `shopify.app.toml` file. This approach is easier since Shopify will automatically sync changes every time you run `deploy` (e.g: `npm run deploy`). Please read these guides to understand more:

1. [app-specific vs shop-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions)
2. [Create a subscription tutorial](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started?deliveryMethod=https)

If you do need shop-specific webhooks, keep in mind that the package calls `afterAuth` in 2 scenarios:

- After installing the app
- When an access token expires

During normal development, the app won't need to re-authenticate most of the time, so shop-specific subscriptions aren't updated. To force your app to update the subscriptions, uninstall and reinstall the app. Revisiting the app will call the `afterAuth` hook.

### Webhooks: Admin created webhook failing HMAC validation

Webhooks subscriptions created in the [Shopify admin](https://help.shopify.com/en/manual/orders/notifications/webhooks) will fail HMAC validation. This is because the webhook payload is not signed with your app's secret key.

The recommended solution is to use [app-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions) defined in your toml file instead. Test your webhooks by triggering events manually in the Shopify admin(e.g. Updating the product title to trigger a `PRODUCTS_UPDATE`).

### Webhooks: Admin object undefined on webhook events triggered by the CLI

When you trigger a webhook event using the Shopify CLI, the `admin` object will be `undefined`. This is because the CLI triggers an event with a valid, but non-existent, shop. The `admin` object is only available when the webhook is triggered by a shop that has installed the app. This is expected.

Webhooks triggered by the CLI are intended for initial experimentation testing of your webhook configuration. For more information on how to test your webhooks, see the [Shopify CLI documentation](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger).

### Incorrect GraphQL Hints

By default the [graphql.vscode-graphql](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql) extension for will assume that GraphQL queries or mutations are for the [Shopify Admin API](https://shopify.dev/docs/api/admin). This is a sensible default, but it may not be true if:

1. You use another Shopify API such as the storefront API.
2. You use a third party GraphQL API.

If so, please update [.graphqlrc.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/.graphqlrc.ts).

### Using Defer & await for streaming responses

By default the CLI uses a cloudflare tunnel. Unfortunately cloudflare tunnels wait for the Response stream to finish, then sends one chunk. This will not affect production.

To test [streaming using await](https://reactrouter.com/api/components/Await#await) during local development we recommend [localhost based development](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options#localhost-based-development).

### "nbf" claim timestamp check failed

This is because a JWT token is expired. If you are consistently getting this error, it could be that the clock on your machine is not in sync with the server. To fix this ensure you have enabled "Set time and date automatically" in the "Date and Time" settings on your computer.

### Using MongoDB and Prisma

If you choose to use MongoDB with Prisma, there are some gotchas in Prisma's MongoDB support to be aware of. Please see the [Prisma SessionStorage README](https://www.npmjs.com/package/@shopify/shopify-app-session-storage-prisma#mongodb).

### Unable to require(`C:\...\query_engine-windows.dll.node`).

Unable to require(`C:\...\query_engine-windows.dll.node`).
The Prisma engines do not seem to be compatible with your system.

query_engine-windows.dll.node is not a valid Win32 application.

**Fix:** Set the environment variable:

```shell
PRISMA_CLIENT_ENGINE_TYPE=binary
```

This forces Prisma to use the binary engine mode, which runs the query engine as a separate process and can work via emulation on Windows ARM64.

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

Internationalization:

- [Internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)
