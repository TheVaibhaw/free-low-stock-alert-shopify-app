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
