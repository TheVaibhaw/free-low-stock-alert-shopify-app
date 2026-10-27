Step 1:-  Setup
-  nvm install 22
-  nvm use 22
-  nvm alias default 22


Step 2:- Creating APP
-  npm init @shopify/app@latest
-  Ok to proceed? (y) - y
-  For your React Router template, which language do you want? - JavaScript
-  App name:
-  npm run dev or shopify app dev

Step 3:- Set Scope

Add this in 'shopify.app.toml' scopes 
scopes = "read_products,read_inventory,read_locations,write_products"

Run:- npm run deploy


Step 4:- Run Migrations
npx prisma migrate dev --name add_alert_models

Step 5:- Add Models
Add this below this file 'prisma/schema.prisma'

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

Again Run this command
npx prisma migrate dev --name add_alert_models


Step 6:- Subscribe Webhook
add this inside this file 'shopify.app.toml'

  [[webhooks.subscriptions]]
  uri = "/webhooks/inventory/update"
  topics = [ "inventory_levels/update" ]

