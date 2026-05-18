import { createKiteClient } from "../kite/kiteClient";
import { getArgValue, hasFlag, usageAndExit } from "./_args";

type Side = "BUY" | "SELL";

type Product = "NRML" | "MIS";

type OrderType = "MARKET" | "LIMIT";

async function main() {
  const tradingsymbol = getArgValue("--tradingsymbol");
  const exchange = getArgValue("--exchange") ?? "NFO";
  const qtyRaw = getArgValue("--qty");
  const side = (getArgValue("--side") ?? "BUY") as Side;
  const orderType = (getArgValue("--order_type") ?? getArgValue("--order-type") ?? "MARKET") as OrderType;
  const product = (getArgValue("--product") ?? "NRML") as Product;
  const priceRaw = getArgValue("--price");
  const confirm = hasFlag("--confirm");

  if (!tradingsymbol || !qtyRaw) {
    usageAndExit(
      "Usage: npm run order:fo -- --tradingsymbol <SYMBOL> --exchange NFO --qty <QTY> --side BUY|SELL --order_type MARKET|LIMIT --product NRML|MIS [--price <LIMIT_PRICE>] [--confirm]",
    );
  }

  const quantity = Number(qtyRaw);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    usageAndExit("--qty must be a positive number");
  }

  const price = priceRaw ? Number(priceRaw) : undefined;
  if (orderType === "LIMIT" && (!price || !Number.isFinite(price) || price <= 0)) {
    usageAndExit("For LIMIT orders, provide --price <LIMIT_PRICE>");
  }

  const orderParams: any = {
    variety: "regular",
    exchange,
    tradingsymbol,
    transaction_type: side,
    quantity,
    product,
    order_type: orderType,
  };

  if (orderType === "LIMIT") orderParams.price = price;

  if (!confirm) {
    // eslint-disable-next-line no-console
    console.log("Dry-run. Re-run with --confirm to place the order.");
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(orderParams, null, 2));
    return;
  }

  const kite = await createKiteClient();
  const orderId = await kite.placeOrder(orderParams.variety, orderParams);

  // eslint-disable-next-line no-console
  console.log({ orderId });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
