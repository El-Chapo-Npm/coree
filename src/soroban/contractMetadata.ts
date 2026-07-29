import { Contract, cereal, xdr } from "@stellar/stellar-sdk";
import { err, ok, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import type { SorokitCache } from "../shared/cache";
import { DEFAULT_CONTRACT_METADATA_TTL_MS } from "../shared/constants";
import { toMessage } from "../shared";
import type { ContractMethod } from "./types";
import { createSorobanServer } from "../shared/serverFactory";

const SPEC_SECTION_NAME = "contractspecv0";

interface MetadataCacheEntry {
  methods: ContractMethod[];
  expiresAt: number;
}

interface ContractMetadataOptions {
  cache?: SorokitCache;
  ttlMs?: number;
  now?: () => number;
}

const memoryCache = new Map<string, MetadataCacheEntry>();
const MAX_MEMORY_CACHE_ENTRIES = 100;

function metadataCacheKey(contractId: string): string {
  return `sorokit:contract-metadata:${contractId}`;
}

function getCachedMethods(
  key: string,
  options?: ContractMetadataOptions,
): ContractMethod[] | null {
  const now = options?.now?.() ?? Date.now();
  const externalValue = options?.cache?.get(key);

  if (isMetadataCacheEntry(externalValue)) {
    if (externalValue.expiresAt > now) return externalValue.methods;
    options?.cache?.invalidate(key);
  }

  const memoryValue = memoryCache.get(key);
  if (!memoryValue) return null;
  if (memoryValue.expiresAt > now) return memoryValue.methods;

  memoryCache.delete(key);
  return null;
}

function setCachedMethods(
  key: string,
  methods: ContractMethod[],
  options?: ContractMetadataOptions,
): void {
  const ttlMs = options?.ttlMs ?? DEFAULT_CONTRACT_METADATA_TTL_MS;
  const expiresAt = (options?.now?.() ?? Date.now()) + ttlMs;
  const entry: MetadataCacheEntry = { methods, expiresAt };

  options?.cache?.set(key, entry, ttlMs);

  // Enforce memory cache size limit
  if (!memoryCache.has(key) && memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value as string | undefined;
    if (oldestKey) memoryCache.delete(oldestKey);
  }

  memoryCache.set(key, entry);
}

/**
 * Manually invalidate cached metadata for a contract ID.
 * Clears both the in-memory cache and an optional external cache.
 */
export function invalidateContractCache(
  contractId: string,
  cache?: SorokitCache,
): void {
  const key = metadataCacheKey(contractId);
  memoryCache.delete(key);
  cache?.invalidate(key);
}

function isMetadataCacheEntry(value: unknown): value is MetadataCacheEntry {
  if (!value || typeof value !== "object") return false;

  const entry = value as Partial<MetadataCacheEntry>;
  return Array.isArray(entry.methods) && typeof entry.expiresAt === "number";
}

function readUnsignedLeb128(
  bytes: Uint8Array,
  offset: number,
): { value: number; nextOffset: number } {
  let value = 0;
  let shift = 0;
  let currentOffset = offset;

  while (currentOffset < bytes.length) {
    const byte = bytes[currentOffset];
    if (byte === undefined) break;
    value |= (byte & 0x7f) << shift;
    currentOffset += 1;

    if ((byte & 0x80) === 0) {
      return { value, nextOffset: currentOffset };
    }

    shift += 7;
    if (shift > 28) break;
  }

  throw new Error("Invalid Wasm LEB128 value.");
}

function readContractSpecSection(wasm: Uint8Array): Uint8Array {
  if (
    wasm.length < 8 ||
    wasm[0] !== 0x00 ||
    wasm[1] !== 0x61 ||
    wasm[2] !== 0x73 ||
    wasm[3] !== 0x6d
  ) {
    throw new Error("Invalid Wasm module.");
  }

  let offset = 8;
  while (offset < wasm.length) {
    const sectionId = wasm[offset];
    offset += 1;

    const sectionSize = readUnsignedLeb128(wasm, offset);
    offset = sectionSize.nextOffset;
    const sectionEnd = offset + sectionSize.value;

    if (sectionEnd > wasm.length) {
      throw new Error("Invalid Wasm section size.");
    }

    if (sectionId === 0) {
      const nameSize = readUnsignedLeb128(wasm, offset);
      offset = nameSize.nextOffset;
      const nameEnd = offset + nameSize.value;

      if (nameEnd > sectionEnd) {
        throw new Error("Invalid Wasm custom section name.");
      }

      const sectionName = new TextDecoder().decode(wasm.subarray(offset, nameEnd));
      if (sectionName === SPEC_SECTION_NAME) {
        return wasm.subarray(nameEnd, sectionEnd);
      }
    }

    offset = sectionEnd;
  }

  throw new Error("Contract spec section not found.");
}

function readSpecEntries(spec: Uint8Array): xdr.ScSpecEntry[] {
  const reader = new cereal.XdrReader(Buffer.from(spec));
  const entries: xdr.ScSpecEntry[] = [];

  while (!reader.eof) {
    entries.push(xdr.ScSpecEntry.read(reader as unknown as Buffer));
  }

  return entries;
}

function methodFromSpecEntry(entry: xdr.ScSpecEntry): ContractMethod | null {
  const kind = xdrName(entry.switch());
  if (!kind.toLowerCase().includes("function")) return null;

  const value = xdrValue(entry);
  const name = stringValue(call(value, "name"));
  const inputs = arrayValue(call(value, "inputs")).map((input) => ({
    name: stringValue(call(input, "name")),
    type: specTypeToString(call(input, "type")),
  }));

  const outputs = arrayValue(call(value, "outputs"));
  const returnType =
    outputs.length === 0
      ? null
      : outputs.map((output) => specTypeToString(output)).join(", ");

  return { name, inputs, returnType };
}

function parseContractMethodsFromWasm(wasm: Uint8Array): ContractMethod[] {
  return readSpecEntries(readContractSpecSection(wasm))
    .map(methodFromSpecEntry)
    .filter((method): method is ContractMethod => method !== null);
}

function getWasmHash(
  executable: xdr.ContractExecutable,
  contractId: string,
): SorokitResult<Buffer> {
  if (executable.switch().name !== "contractExecutableWasm") {
    return err(
      SorokitErrorCode.CONTRACT_READ_FAILED,
      `Contract metadata discovery requires a Wasm contract: ${contractId}`,
    );
  }

  return ok(executable.wasmHash());
}

function specTypeToString(typeDef: unknown): string {
  const kind = xdrName(call(typeDef, "switch"));
  const normalized = kind
    .replace(/^scSpecType/i, "")
    .replace(/^SC_SPEC_TYPE_/, "")
    .toLowerCase();

  switch (normalized) {
    case "option":
      return `option<${specTypeToString(call(call(typeDef, "option"), "valueType"))}>`;
    case "result": {
      const result = call(typeDef, "result");
      return `result<${specTypeToString(call(result, "okType"))}, ${specTypeToString(call(result, "errorType"))}>`;
    }
    case "vec":
      return `vec<${specTypeToString(call(call(typeDef, "vec"), "elementType"))}>`;
    case "map": {
      const map = call(typeDef, "map");
      return `map<${specTypeToString(call(map, "keyType"))}, ${specTypeToString(call(map, "valueType"))}>`;
    }
    case "tuple":
      return `tuple<${arrayValue(call(call(typeDef, "tuple"), "valueTypes"))
        .map((valueType) => specTypeToString(valueType))
        .join(", ")}>`;
    case "bytesn":
      return `bytesN<${String(call(call(typeDef, "bytesN"), "n"))}>`;
    case "udt":
      return stringValue(call(call(typeDef, "udt"), "name"));
    default:
      return normalized || "unknown";
  }
}

function validateCachedMetadata(
  metadata: ContractMethod[] | undefined,
  method: string,
  argCount: number,
): SorokitResult<void> {
  if (!metadata) return ok(undefined);

  const methodMetadata = metadata.find((item) => item.name === method);
  if (!methodMetadata) {
    return err(
      SorokitErrorCode.CONTRACT_PREPARE_FAILED,
      `Contract method not found in cached metadata: ${method}`,
    );
  }

  if (methodMetadata.inputs.length !== argCount) {
    return err(
      SorokitErrorCode.CONTRACT_PREPARE_FAILED,
      `Contract method ${method} expects ${methodMetadata.inputs.length} argument(s), received ${argCount}.`,
    );
  }

  return ok(undefined);
}

function call(target: unknown, method: string): unknown {
  if (!target || typeof target !== "object") return undefined;

  const fn = (target as Record<string, unknown>)[method];
  return typeof fn === "function" ? fn.call(target) : undefined;
}

function xdrValue(target: unknown): unknown {
  const direct = call(target, "value");
  if (direct !== undefined) return direct;

  return call(target, "functionV0");
}

function xdrName(target: unknown): string {
  if (!target || typeof target !== "object") return "";

  const direct = (target as Record<string, unknown>).name;
  if (typeof direct === "string") return direct;

  const name = call(target, "name");
  return typeof name === "string" ? name : "";
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return String(value);
  return "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ─── Schema types ─────────────────────────────────────────────────────────────

/**
 * Typed parameter descriptor within a contract method schema.
 * (issue #206)
 */
export interface ContractMethodParam {
  name: string;
  type: string;
}

/**
 * Full typed signature for a single contract method.
 * (issue #206)
 */
export interface ContractMethodSchema {
  name: string;
  params: ContractMethodParam[];
  returnType: string | null;
}

/**
 * The complete parsed ABI schema for a contract.
 * (issue #206)
 */
export interface ContractSchema {
  contractId: string;
  methods: ContractMethodSchema[];
}

// ─── Schema cache (in-memory, keyed by contractId) ────────────────────────────

const schemaCache = new Map<string, { schema: ContractSchema; expiresAt: number }>();

function schemaCacheKey(contractId: string): string {
  return `sorokit:contract-schema:${contractId}`;
}

function getCachedSchema(contractId: string, now: number): ContractSchema | null {
  const entry = schemaCache.get(schemaCacheKey(contractId));
  if (!entry) return null;
  if (entry.expiresAt > now) return entry.schema;
  schemaCache.delete(schemaCacheKey(contractId));
  return null;
}

function setCachedSchema(
  contractId: string,
  schema: ContractSchema,
  ttlMs: number,
  now: number,
): void {
  schemaCache.set(schemaCacheKey(contractId), { schema, expiresAt: now + ttlMs });
}

export async function getContractMethods(
  rpcUrl: string,
  contractId: string,
  options?: ContractMetadataOptions,
): Promise<SorokitResult<ContractMethod[]>> {
  const cacheKey = metadataCacheKey(contractId);
  const cached = getCachedMethods(cacheKey, options);
  if (cached) return ok(cached);

  try {
    const rpc = createSorobanServer(rpcUrl);
    const contract = new Contract(contractId);
    const instanceResult = await rpc.getLedgerEntries(contract.getFootprint() as any);
    const instanceEntry = instanceResult.entries[0];

    if (!instanceEntry) {
      return err(
        SorokitErrorCode.CONTRACT_READ_FAILED,
        `Contract not found: ${contractId}`,
      );
    }

    const contractData = instanceEntry.val.contractData();
    const wasmHashResult = getWasmHash(
      contractData.val().instance().executable(),
      contractId,
    );
    if (wasmHashResult.status === "error") return wasmHashResult;

    const codeKey = xdr.LedgerKey.contractCode(
      new xdr.LedgerKeyContractCode({ hash: wasmHashResult.data }),
    );
    const codeResult = await rpc.getLedgerEntries(codeKey as any);
    const codeEntry = codeResult.entries[0];

    if (!codeEntry) {
      return err(
        SorokitErrorCode.CONTRACT_READ_FAILED,
        `Contract code not found: ${contractId}`,
      );
    }

    const methods = parseContractMethodsFromWasm(codeEntry.val.contractCode().code());
    setCachedMethods(cacheKey, methods, options);

    return ok(methods);
  } catch (cause) {
    return err(
      SorokitErrorCode.CONTRACT_READ_FAILED,
      `Failed to discover contract methods: ${toMessage(cause)}`,
      cause,
    );
  }
}

export function validateContractMethodMetadata(
  metadata: ContractMethod[] | undefined,
  method: string,
  argCount: number,
  errorCode: SorokitErrorCode,
): SorokitResult<void> {
  const result = validateCachedMetadata(metadata, method, argCount);
  if (result.status === "ok") return result;

  return err(errorCode, result.error.message, result.error.cause);
}

export const contractMetadataInternals = {
  parseContractMethodsFromWasm,
  readContractSpecSection,
};

/**
 * Fetch, parse, and cache the typed ABI schema for a contract.
 *
 * Returns a `ContractSchema` containing every method with its full typed
 * parameter list and return type. Results are cached using the same dual-layer
 * strategy as `getContractMethods` (in-memory LRU + optional external cache).
 *
 * Use `validateContractArgs` to check user-supplied arguments against the
 * schema before passing them to `invokeContract`.
 *
 * @param rpcUrl     - Base URL of the Soroban RPC server.
 * @param contractId - Stellar contract address (C...).
 * @param options    - Optional cache, TTL, and clock override.
 * @returns `ok(ContractSchema)` on success, or a `CONTRACT_READ_FAILED` error.
 *
 * (issue #206)
 */
export async function parseContractSchema(
  rpcUrl: string,
  contractId: string,
  options?: ContractMetadataOptions,
): Promise<SorokitResult<ContractSchema>> {
  const now = options?.now?.() ?? Date.now();
  const ttlMs = options?.ttlMs ?? DEFAULT_CONTRACT_METADATA_TTL_MS;

  // Check external cache first
  const extKey = schemaCacheKey(contractId);
  const extCached = options?.cache?.get(extKey);
  if (extCached && isContractSchema(extCached)) {
    return ok(extCached);
  }

  // Check in-memory cache
  const memoryCached = getCachedSchema(contractId, now);
  if (memoryCached) return ok(memoryCached);

  // Fetch raw methods (reuses the metadata cache internally)
  const methodsResult = await getContractMethods(rpcUrl, contractId, options);
  if (methodsResult.status === "error") return methodsResult;

  const schema: ContractSchema = {
    contractId,
    methods: methodsResult.data.map((m) => ({
      name: m.name,
      params: m.inputs.map((inp) => ({ name: inp.name, type: inp.type })),
      returnType: m.returnType,
    })),
  };

  // Persist to both caches
  setCachedSchema(contractId, schema, ttlMs, now);
  options?.cache?.set(extKey, schema, ttlMs);

  return ok(schema);
}

function isContractSchema(value: unknown): value is ContractSchema {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<ContractSchema>;
  return typeof s.contractId === "string" && Array.isArray(s.methods);
}

/**
 * Validate user-supplied arguments against a parsed `ContractMethodSchema`.
 *
 * Checks:
 * - the method exists in the schema
 * - the number of provided ScVal arguments matches the expected param count
 *
 * Returns `ok(void)` when valid, or a `CONTRACT_PREPARE_FAILED` error
 * describing the mismatch.
 *
 * @param schema    - Schema returned by `parseContractSchema`.
 * @param method    - Name of the method to validate against.
 * @param argCount  - Number of arguments the caller intends to pass.
 *
 * (issue #206)
 */
export function validateContractArgs(
  schema: ContractSchema,
  method: string,
  argCount: number,
): SorokitResult<void> {
  const methodSchema = schema.methods.find((m) => m.name === method);
  if (!methodSchema) {
    return err(
      SorokitErrorCode.CONTRACT_PREPARE_FAILED,
      `Method "${method}" not found in schema for contract ${schema.contractId}. Available: ${schema.methods.map((m) => m.name).join(", ")}`,
    );
  }

  if (methodSchema.params.length !== argCount) {
    return err(
      SorokitErrorCode.CONTRACT_PREPARE_FAILED,
      `Method "${method}" expects ${methodSchema.params.length} argument(s) [${methodSchema.params.map((p) => `${p.name}: ${p.type}`).join(", ")}], but ${argCount} were provided.`,
    );
  }

  return ok(undefined);
}
