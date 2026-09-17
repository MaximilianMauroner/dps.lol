import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export const SOURCE_SCHEMA_VERSION = "riot-match-timeline-v1";
export const EXTRACTOR_VERSION = "timeline-extractor-v2";
export const DATASET_VERSION = "26.18-euw-ranked-solo-v1";
export const ENGINE_VERSION = "yunara-engine-v1";

export interface MatchArchiveSource {
  schemaVersion: string;
  match: unknown;
  timeline: unknown;
}

export interface CompressedArchive {
  source: MatchArchiveSource;
  uncompressed: Uint8Array;
  compressed: Uint8Array;
  sha256: string;
  compressedBytes: number;
  uncompressedBytes: number;
}

export function buildMatchArchive(match: unknown, timeline: unknown): MatchArchiveSource {
  return { schemaVersion: SOURCE_SCHEMA_VERSION, match, timeline };
}

export function compressArchive(source: MatchArchiveSource): CompressedArchive {
  const uncompressed = Buffer.from(JSON.stringify(source));
  const compressed = gzipSync(uncompressed, { level: 9 });
  const sha256 = createHash("sha256").update(compressed).digest("hex");
  return {
    source,
    uncompressed,
    compressed,
    sha256,
    compressedBytes: compressed.byteLength,
    uncompressedBytes: uncompressed.byteLength,
  };
}

export function archiveObjectKey(patch: string, region: string, sha256: string): string {
  return `raw/patch=${patch}/region=${region}/sha256=${sha256}/match-source.json.gz`;
}

export function archiveConfig() {
  const bucket = process.env.BUCKET ?? process.env.RAILWAY_BUCKET ?? process.env.S3_BUCKET;
  const endpoint = process.env.ENDPOINT ?? process.env.S3_ENDPOINT;
  const accessKeyId = process.env.ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY;
  const region = process.env.REGION ?? process.env.S3_REGION ?? "auto";
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return { bucket, endpoint, accessKeyId, secretAccessKey, region };
}

function client() {
  const config = archiveConfig();
  if (!config) throw new Error("Railway bucket S3 variables are not configured");
  return {
    config,
    s3: new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: false,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
  };
}

export async function listArchiveKeys(prefix = "raw/"): Promise<string[]> {
  const { config, s3 } = client();
  const result = await s3.send(
    new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, MaxKeys: 1000 }),
  );
  return (result.Contents ?? [])
    .map((entry) => entry.Key)
    .filter((key): key is string => Boolean(key));
}

export async function verifyArchiveKey(
  key: string,
  expected: { sha256?: string; compressedBytes?: number },
) {
  const { config, s3 } = client();
  const head = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
  return {
    key,
    bytesMatch:
      expected.compressedBytes === undefined ||
      Number(head.ContentLength ?? -1) === expected.compressedBytes,
    checksumMatch: expected.sha256 === undefined || head.Metadata?.sha256 === expected.sha256,
  };
}

export async function putVerifiedArchive(
  archive: CompressedArchive,
  input: { patch: string; region: string },
): Promise<{ key: string; sha256: string; compressedBytes: number; uncompressedBytes: number }> {
  const { config, s3 } = client();
  const key = archiveObjectKey(input.patch, input.region, archive.sha256);
  const head = async () => {
    try {
      return await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number }; name?: string }).$metadata
        ?.httpStatusCode;
      const name = (error as { name?: string }).name;
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") return null;
      throw error;
    }
  };
  const existing = await head();
  if (!existing) {
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: archive.compressed,
        ContentType: "application/json",
        ContentEncoding: "gzip",
        Metadata: {
          sha256: archive.sha256,
          uncompressed_bytes: String(archive.uncompressedBytes),
          source_schema_version: SOURCE_SCHEMA_VERSION,
        },
      }),
    );
  }
  const verified = await head();
  if (!verified || Number(verified.ContentLength ?? -1) !== archive.compressedBytes) {
    throw new Error(`Archive verification failed for ${key}`);
  }
  if (verified.Metadata?.sha256 !== archive.sha256) {
    throw new Error(`Archive checksum metadata mismatch for ${key}`);
  }
  return {
    key,
    sha256: archive.sha256,
    compressedBytes: archive.compressedBytes,
    uncompressedBytes: archive.uncompressedBytes,
  };
}

export function archiveEnabled(): boolean {
  return Boolean(archiveConfig());
}

export async function readArchivedSource(key: string): Promise<MatchArchiveSource> {
  const { config, s3 } = client();
  const result = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  if (!result.Body) throw new Error(`Archive object has no body: ${key}`);
  const bytes = await result.Body.transformToByteArray();
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as MatchArchiveSource;
}
