import { getArgValue, usageAndExit } from "./_args";
import { analyzeBreadth, loadWeights } from "../analysis/nifty50Breadth";
import { equalWeightsForNifty50 } from "../analysis/weightsFallback";

async function main() {
  const weightsPath = getArgValue("--weights");

  let weights;
  if (!weightsPath) {
    weights = equalWeightsForNifty50();
  } else {
    try {
      weights = await loadWeights(weightsPath);
    } catch {
      weights = equalWeightsForNifty50();
    }

    if (weights.length < 30) {
      // eslint-disable-next-line no-console
      console.error(`Weights file has only ${weights.length} rows; falling back to equal-weight NIFTY50 universe.`);
      weights = equalWeightsForNifty50();
    }
  }

  const out = await analyzeBreadth(weights);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
