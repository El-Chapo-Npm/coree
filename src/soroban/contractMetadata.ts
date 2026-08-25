import { Contract, cereal, rpc as SorobanRpc, xdr } from "@stellar/stellar-sdk";
import { err, ok, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";
import type { SorokitCache } from "../shared/cache";
import { DEFAULT_CONTRACT_METADATA_TTL_MS } from "../shared/constants";
import { toMessage } from "../shared";
import type { ContractMethod } from "./types";
import { createHorizonServer, createSorobanServer } from "../shared/serverFactory";

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

// Maps ScVal type names (e.g. "scvU128") to the ABI type strings produced by specTypeToString()
const SCV_TO_ABI_TYPE: Record<string, string> = {
  scvBool: "bool",
  scvU32: "u32",
  scvI32: "i32",
  scvU64: "u64",
  scvI64: "i64",
  scvU128: "u128",
  scvI128: "i128",
  scvString: "string",
  scvSymbol: "symbol",
  scvBytes: "bytes",
  scvVoid: "void",
  scvVec: "vec",
  scvMap: "map",
  scvAddress: "address",
};

/**
 * Validates that each ScVal argument matches the expected type declared in the
 * contract method's ABI inputs. Only validates args that have a matching input;
 * count mismatch is already handled by validateContractMethodMetadata().
 */
export function validateContractArgs(
  method: ContractMethod,
  args: xdr.ScVal[],
  errorCode: SorokitErrorCode,
): SorokitResult<void> {
  for (let i = 0; i < args.length; i++) {
    const input = method.inputs[i];
    const arg = args[i];
    if (!input || !arg) continue;

    const scvName: string = arg.switch().name;
    const actualType = SCV_TO_ABI_TYPE[scvName] ?? scvName;
    const expectedType = input.type;

    // Allow vec/map/option/result/tuple as prefix matches (e.g. "vec<address>")
    const expectedBase = expectedType.split("<")[0];
    if (actualType !== expectedBase && actualType !== expectedType) {
      return err(
        errorCode,
        `Argument "${input.name}" (position ${i}): expected type "${expectedType}", got "${actualType}"`,
      );
    }
  }

  return ok(undefined);
}

export const contractMetadataInternals = {
  parseContractMethodsFromWasm,
  readContractSpecSection,
};
