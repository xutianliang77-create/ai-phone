import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { RecordingArtifactConfig } from "./livekit-egress-readiness.js";

export class RecordingObjectStore {
  private readonly client: S3Client;

  constructor(private readonly config: RecordingArtifactConfig, client?: S3Client) {
    this.client = client ?? new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });
  }

  async verifyAudio(objectKey: string) {
    const head = await this.client.send(new HeadObjectCommand({
      Bucket: this.config.bucket,
      Key: objectKey,
    }));
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: objectKey,
    }));
    if (!response.Body) throw new Error("Recording object body is missing");
    const digest = createHash("sha256");
    let sizeBytes = 0;
    for await (const value of response.Body as AsyncIterable<Uint8Array | string>) {
      const chunk = typeof value === "string" ? Buffer.from(value) : value;
      digest.update(chunk);
      sizeBytes += chunk.byteLength;
    }
    if (head.ContentLength !== undefined && head.ContentLength !== sizeBytes) {
      throw new Error("Recording object size changed during verification");
    }
    return {
      sizeBytes,
      sha256: digest.digest("hex"),
      ...(head.ETag ? { etag: head.ETag.replace(/^"|"$/g, "") } : {}),
      ...(head.VersionId ? { storageVersionId: head.VersionId } : {}),
    };
  }

  async putManifest(input: {
    objectKey: string;
    body: string;
    audioSha256: string;
  }) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.objectKey,
      Body: input.body,
      ContentType: "application/json",
      ServerSideEncryption: this.config.serverSideEncryption,
      ...(this.config.kmsKeyId ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
      Metadata: { "audio-sha256": input.audioSha256 },
    }));
  }

  async delete(objectKey: string) {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: objectKey,
    }));
  }

  destroy() {
    this.client.destroy();
  }
}
