import { Client, type Result, type RequestError } from "@replit/object-storage";
import { PassThrough } from "node:stream";

let ready: Promise<Client> | undefined;

function getClient(): Promise<Client> {
  if (!ready) {
    ready = (async () => {
      const client = new Client();
      // Immediately await initialization so a missing bucket cannot produce
      // an unhandled rejection in the SDK's constructor.
      const result = await client.list({ maxResults: 1 });
      if (!result.ok) throw new Error(result.error.message);
      return client;
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}

function unavailable(error: unknown): Result<null, RequestError> {
  return {
    ok: false,
    error: {
      message: error instanceof Error ? error.message : "App Storage is unavailable.",
      statusCode: 503,
    },
  };
}

export const appStorage = {
  async uploadFromBytes(...args: Parameters<Client["uploadFromBytes"]>) {
    try {
      return await (await getClient()).uploadFromBytes(...args);
    } catch (error) {
      return unavailable(error);
    }
  },
  async delete(...args: Parameters<Client["delete"]>) {
    try {
      return await (await getClient()).delete(...args);
    } catch (error) {
      return unavailable(error);
    }
  },
  downloadAsStream(objectKey: string) {
    const output = new PassThrough();
    void getClient().then((client) => {
      const source = client.downloadAsStream(objectKey);
      source.on("error", (error) => output.destroy(error));
      output.on("close", () => source.destroy());
      source.pipe(output);
    }).catch((error) => output.destroy(error));
    return output;
  },
};
