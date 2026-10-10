import { expect, it } from "vitest";
import { signS3Request } from "@/infrastructure/storage/s3-blob-store";

// The "GET Object" example from AWS's Signature Version 4 documentation for S3.
const example = {
  region: "us-east-1", accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  method: "GET", path: "/test.txt", query: {},
  headers: {
    host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9",
    "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "x-amz-date": "20130524T000000Z",
  },
};

it("signs AWS's published GET Object example to the published signature", () => {
  expect(signS3Request(example)).toBe(
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
    "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
    "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});
it("signs AWS's published bucket listing example, with query parameters sorted and encoded", () => {
  const { range: _range, ...headers } = example.headers;
  void _range;
  expect(signS3Request({ ...example, path: "/", query: { prefix: "J", "max-keys": "2" }, headers })).toContain(
    "Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
  );
});
it("changes the signature when the payload hash, a header or the secret changes", () => {
  const base = signS3Request(example);
  expect(signS3Request({ ...example, secretKey: "other" })).not.toBe(base);
  expect(signS3Request({ ...example, headers: { ...example.headers, "x-amz-content-sha256": "a".repeat(64) } })).not.toBe(base);
  expect(signS3Request({ ...example, headers: { ...example.headers, range: "bytes=0-8" } })).not.toBe(base);
});
