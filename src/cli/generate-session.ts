import { generateAndStoreSession } from "../kite/auth";
import { env } from "../config/env";
import { getArgValue, usageAndExit } from "./_args";

async function main() {
  const requestToken =
    getArgValue("--request_token") ??
    getArgValue("--request-token") ??
    getArgValue("--requestToken") ??
    getArgValue("--requesttoken") ??
    // Be forgiving for common invocation mistakes like:
    //   npm run session:generate -- -- requestToken <TOKEN>
    // where argv ends up containing: ["--", "requestToken", "<TOKEN>"]
    getArgValue("request_token") ??
    getArgValue("request-token") ??
    getArgValue("requestToken") ??
    getArgValue("requesttoken");

  if (!requestToken) {
    usageAndExit(
      "Usage:\n" +
        "  npm run session:generate -- --request_token <REQUEST_TOKEN>\n" +
        "  npm run session:generate -- --requestToken <REQUEST_TOKEN>\n" +
        "\n" +
        "Aliases:\n" +
        "  --request-token, --requestToken\n" +
        "\n" +
        "Notes:\n" +
        "  - Do not put a space between the flag and its name (use --requestToken, not -- requestToken).\n" +
        "  - REQUEST_TOKEN is short-lived; generate the session immediately after login.",
    );
  }

  await generateAndStoreSession(requestToken);
  // eslint-disable-next-line no-console
  console.log("Session generated and stored.");
}

main().catch((err) => {
  const apiKey = env.KITE_API_KEY;
  const maskedKey = apiKey.length <= 8 ? "(set)" : `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
  // eslint-disable-next-line no-console
  console.error(`Failed to generate session (apiKey=${maskedKey}).`);

  const anyErr = err as any;
  const body = anyErr?.response?.data ?? anyErr?.data;
  if (body) {
    // eslint-disable-next-line no-console
    console.error(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
