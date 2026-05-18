import { getArgValue, usageAndExit } from "./_args";
import { analyzeNiftyBias } from "../analysis/niftyBias";
import { pickNearExpiryNiftyFutureKey, pickNearestWeeklyNiftyOptionExpiry } from "../analysis/defaults";

async function main() {
  const spotKey = getArgValue("--spot") ?? "NSE:NIFTY 50";
  let futKey = getArgValue("--fut") ?? undefined;
  const underlying = getArgValue("--underlying") ?? "NIFTY";
  let expiry = getArgValue("--expiry") ?? undefined;

  // Defaults: near-expiry FUT + nearest weekly option expiry.
  if (!futKey) futKey = await pickNearExpiryNiftyFutureKey(underlying);
  if (!expiry) expiry = await pickNearestWeeklyNiftyOptionExpiry(underlying);

  const strikesAroundAtm = Number(getArgValue("--strikes") ?? "10");
  const vixKey = getArgValue("--vix") ?? undefined;
  const newsSentiment = (getArgValue("--news") as any) ?? undefined;
  const globalCue = (getArgValue("--global") as any) ?? undefined;

  const output = await analyzeNiftyBias({
    spotKey,
    futKey,
    underlying,
    expiry,
    strikesAroundAtm,
    vixKey,
    newsSentiment,
    globalCue,
  });

  // Strict JSON output
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
