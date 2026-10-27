import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const settings = await db.settings.findUnique({ where: { shop: session.shop } });
  const threshold = settings?.threshold ?? 5;

  const response = await admin.graphql(
    `#graphql
    query lowStock($query: String!) {
      productVariants(first: 50, query: $query) {
        nodes {
          id
          displayName
          sku
          inventoryQuantity
          product { id }
        }
      }
    }`,
    { variables: { query: `inventory_quantity:<=${threshold}` } },
  );
  const { data } = await response.json();

  const recentAlerts = await db.alertLog.findMany({
    where: { shop: session.shop },
    orderBy: { sentAt: "desc" },
    take: 10,
  });

  return {
    threshold,
    enabled: settings?.enabled ?? true,
    variants: data.productVariants.nodes,
    recentAlerts: recentAlerts.map((a) => ({
      id: a.id,
      quantity: a.quantity,
      sentAt: a.sentAt.toISOString(),
    })),
  };
};

export default function Dashboard() {
  const { threshold, enabled, variants, recentAlerts } = useLoaderData();

  return (
    <s-page heading="Low Stock Dashboard">
      <s-link slot="secondary-actions" href="/app/settings">Settings</s-link>

      {!enabled && (
        <s-banner tone="warning">
          Alerts band hain. Settings mein jaake enable karo.
        </s-banner>
      )}

      <s-section heading={`Low stock products (≤ ${threshold})`}>
        {variants.length === 0 ? (
          <s-paragraph>Sab products ka stock theek hai. 🎉</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>SKU</s-table-header>
              <s-table-header>Available</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {variants.map((v) => (
                <s-table-row key={v.id}>
                  <s-table-cell>
                    <s-link
                      href={`shopify://admin/products/${v.product.id.split("/").pop()}`}
                      target="_blank"
                    >
                      {v.displayName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{v.sku || "-"}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={v.inventoryQuantity <= 0 ? "critical" : "warning"}>
                      {v.inventoryQuantity}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Recent alerts">
        {recentAlerts.length === 0 ? (
          <s-paragraph>Abhi tak koi alert nahi gaya.</s-paragraph>
        ) : (
          <s-unordered-list>
            {recentAlerts.map((a) => (
              <s-list-item key={a.id}>
                Qty {a.quantity} — {new Date(a.sentAt).toLocaleString()}
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};