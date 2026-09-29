import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { type Client, type PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { classifyHederaError, PassportError } from "./errors";
import type { TopicMessage } from "./mirror";

/**
 * HCS-1 stores a file in its own topic: memo `<sha256>:zstd:base64`, content
 * zstd-compressed, base64-encoded behind a data-URI prefix, and split into
 * `{"o": index, "c": chunk}` messages of at most 1024 bytes.
 * Spec: https://hol.org/docs/standards/hcs-1
 *
 * HCS-11 profiles live in HCS-1 files. Writing them directly (instead of via a
 * hosted inscription service) keeps agent registration dependent on Hedera
 * alone. Uses node:zlib's zstd support, available from Node 22.15.
 */

const MAX_MESSAGE_BYTES = 1024;
/** Leaves room for the `{"o":123,"c":""}` wrapper inside 1024 bytes. */
const CHUNK_CHARS = MAX_MESSAGE_BYTES - 32;

function zstd(): { compress: (b: Buffer) => Buffer; decompress: (b: Buffer) => Buffer } {
  if (typeof zlib.zstdCompressSync !== "function") {
    throw new PassportError(
      "INVALID_CONFIG",
      `Node ${process.version} has no built-in zstd, which HCS-1 files require.`,
      "Use Node.js 22.15 or newer (see .nvmrc).",
    );
  }
  return { compress: zlib.zstdCompressSync, decompress: zlib.zstdDecompressSync };
}

interface Hcs1File {
  memo: string;
  messages: string[];
}

export function encodeHcs1(content: Buffer, mimeType: string): Hcs1File {
  const hash = createHash("sha256").update(content).digest("hex");
  const payload = `data:${mimeType};base64,${zstd().compress(content).toString("base64")}`;
  const messages: string[] = [];
  for (let offset = 0, o = 0; offset < payload.length; offset += CHUNK_CHARS, o++) {
    messages.push(JSON.stringify({ o, c: payload.slice(offset, offset + CHUNK_CHARS) }));
  }
  return { memo: `${hash}:zstd:base64`, messages };
}

/**
 * Reassembles an HCS-1 file from its topic messages and checks it against the
 * hash in the topic memo, so the content is proven, not just fetched.
 */
export function decodeHcs1(
  memo: string,
  messages: Pick<TopicMessage, "contents">[],
): { mimeType: string; content: Buffer } {
  const [hash, algo, encoding] = memo.split(":");
  if (!hash || algo !== "zstd" || encoding !== "base64") {
    throw new Error(`"${memo}" is not an HCS-1 topic memo`);
  }
  const chunks = messages
    .map(m => JSON.parse(m.contents) as { o: number; c: string })
    .sort((a, b) => a.o - b.o)
    .map(chunk => chunk.c)
    .join("");
  const match = /^data:([^;]+);base64,(.*)$/s.exec(chunks);
  if (!match) throw new Error("HCS-1 content has no data URI prefix");
  const content = zstd().decompress(Buffer.from(match[2]!, "base64"));
  if (createHash("sha256").update(content).digest("hex") !== hash) {
    throw new Error("HCS-1 content does not match the hash in the topic memo");
  }
  return { mimeType: match[1]!, content };
}

/**
 * Writes `content` as an HCS-1 file. Per the spec the topic has a submit key
 * (the writer's) and no admin key, so the file can never be altered.
 */
export async function writeHcs1File(
  client: Client,
  submitKey: PrivateKey,
  content: Buffer,
  mimeType: string,
): Promise<string> {
  const file = encodeHcs1(content, mimeType);
  let topicId: string;
  try {
    const created = await new TopicCreateTransaction()
      .setTopicMemo(file.memo)
      .setSubmitKey(submitKey.publicKey)
      .execute(client);
    topicId = (await created.getReceipt(client)).topicId!.toString();
  } catch (error) {
    throw classifyHederaError(error, "create the HCS-1 file topic");
  }
  for (const message of file.messages) {
    try {
      const submitted = await new TopicMessageSubmitTransaction({ topicId, message }).execute(client);
      await submitted.getReceipt(client);
    } catch (error) {
      throw classifyHederaError(error, `write a chunk of HCS-1 file ${topicId}`);
    }
  }
  return topicId;
}
