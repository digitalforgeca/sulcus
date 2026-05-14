var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_node_path = require("node:path");
var import_node_fs = require("node:fs");
var https = __toESM(require("node:https"));
var http = __toESM(require("node:http"));
var import_node_url = require("node:url");

// node_modules/@sinclair/typebox/build/esm/type/guard/value.mjs
var value_exports = {};
__export(value_exports, {
  HasPropertyKey: () => HasPropertyKey,
  IsArray: () => IsArray,
  IsAsyncIterator: () => IsAsyncIterator,
  IsBigInt: () => IsBigInt,
  IsBoolean: () => IsBoolean,
  IsDate: () => IsDate,
  IsFunction: () => IsFunction,
  IsIterator: () => IsIterator,
  IsNull: () => IsNull,
  IsNumber: () => IsNumber,
  IsObject: () => IsObject,
  IsRegExp: () => IsRegExp,
  IsString: () => IsString,
  IsSymbol: () => IsSymbol,
  IsUint8Array: () => IsUint8Array,
  IsUndefined: () => IsUndefined
});
function HasPropertyKey(value, key) {
  return key in value;
}
function IsAsyncIterator(value) {
  return IsObject(value) && !IsArray(value) && !IsUint8Array(value) && Symbol.asyncIterator in value;
}
function IsArray(value) {
  return Array.isArray(value);
}
function IsBigInt(value) {
  return typeof value === "bigint";
}
function IsBoolean(value) {
  return typeof value === "boolean";
}
function IsDate(value) {
  return value instanceof globalThis.Date;
}
function IsFunction(value) {
  return typeof value === "function";
}
function IsIterator(value) {
  return IsObject(value) && !IsArray(value) && !IsUint8Array(value) && Symbol.iterator in value;
}
function IsNull(value) {
  return value === null;
}
function IsNumber(value) {
  return typeof value === "number";
}
function IsObject(value) {
  return typeof value === "object" && value !== null;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsString(value) {
  return typeof value === "string";
}
function IsSymbol(value) {
  return typeof value === "symbol";
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUndefined(value) {
  return value === void 0;
}

// node_modules/@sinclair/typebox/build/esm/type/clone/value.mjs
function ArrayType(value) {
  return value.map((value2) => Visit(value2));
}
function DateType(value) {
  return new Date(value.getTime());
}
function Uint8ArrayType(value) {
  return new Uint8Array(value);
}
function RegExpType(value) {
  return new RegExp(value.source, value.flags);
}
function ObjectType(value) {
  const result = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    result[key] = Visit(value[key]);
  }
  for (const key of Object.getOwnPropertySymbols(value)) {
    result[key] = Visit(value[key]);
  }
  return result;
}
function Visit(value) {
  return IsArray(value) ? ArrayType(value) : IsDate(value) ? DateType(value) : IsUint8Array(value) ? Uint8ArrayType(value) : IsRegExp(value) ? RegExpType(value) : IsObject(value) ? ObjectType(value) : value;
}
function Clone(value) {
  return Visit(value);
}

// node_modules/@sinclair/typebox/build/esm/type/clone/type.mjs
function CloneType(schema, options) {
  return options === void 0 ? Clone(schema) : Clone({ ...options, ...schema });
}

// node_modules/@sinclair/typebox/build/esm/value/guard/guard.mjs
function IsObject2(value) {
  return value !== null && typeof value === "object";
}
function IsArray2(value) {
  return globalThis.Array.isArray(value) && !globalThis.ArrayBuffer.isView(value);
}
function IsUndefined2(value) {
  return value === void 0;
}
function IsNumber2(value) {
  return typeof value === "number";
}

// node_modules/@sinclair/typebox/build/esm/system/policy.mjs
var TypeSystemPolicy;
(function(TypeSystemPolicy2) {
  TypeSystemPolicy2.InstanceMode = "default";
  TypeSystemPolicy2.ExactOptionalPropertyTypes = false;
  TypeSystemPolicy2.AllowArrayObject = false;
  TypeSystemPolicy2.AllowNaN = false;
  TypeSystemPolicy2.AllowNullVoid = false;
  function IsExactOptionalProperty(value, key) {
    return TypeSystemPolicy2.ExactOptionalPropertyTypes ? key in value : value[key] !== void 0;
  }
  TypeSystemPolicy2.IsExactOptionalProperty = IsExactOptionalProperty;
  function IsObjectLike(value) {
    const isObject = IsObject2(value);
    return TypeSystemPolicy2.AllowArrayObject ? isObject : isObject && !IsArray2(value);
  }
  TypeSystemPolicy2.IsObjectLike = IsObjectLike;
  function IsRecordLike(value) {
    return IsObjectLike(value) && !(value instanceof Date) && !(value instanceof Uint8Array);
  }
  TypeSystemPolicy2.IsRecordLike = IsRecordLike;
  function IsNumberLike(value) {
    return TypeSystemPolicy2.AllowNaN ? IsNumber2(value) : Number.isFinite(value);
  }
  TypeSystemPolicy2.IsNumberLike = IsNumberLike;
  function IsVoidLike(value) {
    const isUndefined = IsUndefined2(value);
    return TypeSystemPolicy2.AllowNullVoid ? isUndefined || value === null : isUndefined;
  }
  TypeSystemPolicy2.IsVoidLike = IsVoidLike;
})(TypeSystemPolicy || (TypeSystemPolicy = {}));

// node_modules/@sinclair/typebox/build/esm/type/create/immutable.mjs
function ImmutableArray(value) {
  return globalThis.Object.freeze(value).map((value2) => Immutable(value2));
}
function ImmutableDate(value) {
  return value;
}
function ImmutableUint8Array(value) {
  return value;
}
function ImmutableRegExp(value) {
  return value;
}
function ImmutableObject(value) {
  const result = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    result[key] = Immutable(value[key]);
  }
  for (const key of Object.getOwnPropertySymbols(value)) {
    result[key] = Immutable(value[key]);
  }
  return globalThis.Object.freeze(result);
}
function Immutable(value) {
  return IsArray(value) ? ImmutableArray(value) : IsDate(value) ? ImmutableDate(value) : IsUint8Array(value) ? ImmutableUint8Array(value) : IsRegExp(value) ? ImmutableRegExp(value) : IsObject(value) ? ImmutableObject(value) : value;
}

// node_modules/@sinclair/typebox/build/esm/type/create/type.mjs
function CreateType(schema, options) {
  const result = options !== void 0 ? { ...options, ...schema } : schema;
  switch (TypeSystemPolicy.InstanceMode) {
    case "freeze":
      return Immutable(result);
    case "clone":
      return Clone(result);
    default:
      return result;
  }
}

// node_modules/@sinclair/typebox/build/esm/type/error/error.mjs
var TypeBoxError = class extends Error {
  constructor(message) {
    super(message);
  }
};

// node_modules/@sinclair/typebox/build/esm/type/symbols/symbols.mjs
var TransformKind = /* @__PURE__ */ Symbol.for("TypeBox.Transform");
var ReadonlyKind = /* @__PURE__ */ Symbol.for("TypeBox.Readonly");
var OptionalKind = /* @__PURE__ */ Symbol.for("TypeBox.Optional");
var Hint = /* @__PURE__ */ Symbol.for("TypeBox.Hint");
var Kind = /* @__PURE__ */ Symbol.for("TypeBox.Kind");

// node_modules/@sinclair/typebox/build/esm/type/guard/kind.mjs
function IsReadonly(value) {
  return IsObject(value) && value[ReadonlyKind] === "Readonly";
}
function IsOptional(value) {
  return IsObject(value) && value[OptionalKind] === "Optional";
}
function IsAny(value) {
  return IsKindOf(value, "Any");
}
function IsArgument(value) {
  return IsKindOf(value, "Argument");
}
function IsArray3(value) {
  return IsKindOf(value, "Array");
}
function IsAsyncIterator2(value) {
  return IsKindOf(value, "AsyncIterator");
}
function IsBigInt2(value) {
  return IsKindOf(value, "BigInt");
}
function IsBoolean2(value) {
  return IsKindOf(value, "Boolean");
}
function IsComputed(value) {
  return IsKindOf(value, "Computed");
}
function IsConstructor(value) {
  return IsKindOf(value, "Constructor");
}
function IsDate2(value) {
  return IsKindOf(value, "Date");
}
function IsFunction2(value) {
  return IsKindOf(value, "Function");
}
function IsInteger(value) {
  return IsKindOf(value, "Integer");
}
function IsIntersect(value) {
  return IsKindOf(value, "Intersect");
}
function IsIterator2(value) {
  return IsKindOf(value, "Iterator");
}
function IsKindOf(value, kind) {
  return IsObject(value) && Kind in value && value[Kind] === kind;
}
function IsLiteralValue(value) {
  return IsBoolean(value) || IsNumber(value) || IsString(value);
}
function IsLiteral(value) {
  return IsKindOf(value, "Literal");
}
function IsMappedKey(value) {
  return IsKindOf(value, "MappedKey");
}
function IsMappedResult(value) {
  return IsKindOf(value, "MappedResult");
}
function IsNever(value) {
  return IsKindOf(value, "Never");
}
function IsNot(value) {
  return IsKindOf(value, "Not");
}
function IsNull2(value) {
  return IsKindOf(value, "Null");
}
function IsNumber3(value) {
  return IsKindOf(value, "Number");
}
function IsObject3(value) {
  return IsKindOf(value, "Object");
}
function IsPromise(value) {
  return IsKindOf(value, "Promise");
}
function IsRecord(value) {
  return IsKindOf(value, "Record");
}
function IsRef(value) {
  return IsKindOf(value, "Ref");
}
function IsRegExp2(value) {
  return IsKindOf(value, "RegExp");
}
function IsString2(value) {
  return IsKindOf(value, "String");
}
function IsSymbol2(value) {
  return IsKindOf(value, "Symbol");
}
function IsTemplateLiteral(value) {
  return IsKindOf(value, "TemplateLiteral");
}
function IsThis(value) {
  return IsKindOf(value, "This");
}
function IsTransform(value) {
  return IsObject(value) && TransformKind in value;
}
function IsTuple(value) {
  return IsKindOf(value, "Tuple");
}
function IsUndefined3(value) {
  return IsKindOf(value, "Undefined");
}
function IsUnion(value) {
  return IsKindOf(value, "Union");
}
function IsUint8Array2(value) {
  return IsKindOf(value, "Uint8Array");
}
function IsUnknown(value) {
  return IsKindOf(value, "Unknown");
}
function IsUnsafe(value) {
  return IsKindOf(value, "Unsafe");
}
function IsVoid(value) {
  return IsKindOf(value, "Void");
}
function IsKind(value) {
  return IsObject(value) && Kind in value && IsString(value[Kind]);
}
function IsSchema(value) {
  return IsAny(value) || IsArgument(value) || IsArray3(value) || IsBoolean2(value) || IsBigInt2(value) || IsAsyncIterator2(value) || IsComputed(value) || IsConstructor(value) || IsDate2(value) || IsFunction2(value) || IsInteger(value) || IsIntersect(value) || IsIterator2(value) || IsLiteral(value) || IsMappedKey(value) || IsMappedResult(value) || IsNever(value) || IsNot(value) || IsNull2(value) || IsNumber3(value) || IsObject3(value) || IsPromise(value) || IsRecord(value) || IsRef(value) || IsRegExp2(value) || IsString2(value) || IsSymbol2(value) || IsTemplateLiteral(value) || IsThis(value) || IsTuple(value) || IsUndefined3(value) || IsUnion(value) || IsUint8Array2(value) || IsUnknown(value) || IsUnsafe(value) || IsVoid(value) || IsKind(value);
}

// node_modules/@sinclair/typebox/build/esm/type/guard/type.mjs
var type_exports = {};
__export(type_exports, {
  IsAny: () => IsAny2,
  IsArgument: () => IsArgument2,
  IsArray: () => IsArray4,
  IsAsyncIterator: () => IsAsyncIterator3,
  IsBigInt: () => IsBigInt3,
  IsBoolean: () => IsBoolean3,
  IsComputed: () => IsComputed2,
  IsConstructor: () => IsConstructor2,
  IsDate: () => IsDate3,
  IsFunction: () => IsFunction3,
  IsImport: () => IsImport,
  IsInteger: () => IsInteger2,
  IsIntersect: () => IsIntersect2,
  IsIterator: () => IsIterator3,
  IsKind: () => IsKind2,
  IsKindOf: () => IsKindOf2,
  IsLiteral: () => IsLiteral2,
  IsLiteralBoolean: () => IsLiteralBoolean,
  IsLiteralNumber: () => IsLiteralNumber,
  IsLiteralString: () => IsLiteralString,
  IsLiteralValue: () => IsLiteralValue2,
  IsMappedKey: () => IsMappedKey2,
  IsMappedResult: () => IsMappedResult2,
  IsNever: () => IsNever2,
  IsNot: () => IsNot2,
  IsNull: () => IsNull3,
  IsNumber: () => IsNumber4,
  IsObject: () => IsObject4,
  IsOptional: () => IsOptional2,
  IsPromise: () => IsPromise2,
  IsProperties: () => IsProperties,
  IsReadonly: () => IsReadonly2,
  IsRecord: () => IsRecord2,
  IsRecursive: () => IsRecursive,
  IsRef: () => IsRef2,
  IsRegExp: () => IsRegExp3,
  IsSchema: () => IsSchema2,
  IsString: () => IsString3,
  IsSymbol: () => IsSymbol3,
  IsTemplateLiteral: () => IsTemplateLiteral2,
  IsThis: () => IsThis2,
  IsTransform: () => IsTransform2,
  IsTuple: () => IsTuple2,
  IsUint8Array: () => IsUint8Array3,
  IsUndefined: () => IsUndefined4,
  IsUnion: () => IsUnion2,
  IsUnionLiteral: () => IsUnionLiteral,
  IsUnknown: () => IsUnknown2,
  IsUnsafe: () => IsUnsafe2,
  IsVoid: () => IsVoid2,
  TypeGuardUnknownTypeError: () => TypeGuardUnknownTypeError
});
var TypeGuardUnknownTypeError = class extends TypeBoxError {
};
var KnownTypes = [
  "Argument",
  "Any",
  "Array",
  "AsyncIterator",
  "BigInt",
  "Boolean",
  "Computed",
  "Constructor",
  "Date",
  "Enum",
  "Function",
  "Integer",
  "Intersect",
  "Iterator",
  "Literal",
  "MappedKey",
  "MappedResult",
  "Not",
  "Null",
  "Number",
  "Object",
  "Promise",
  "Record",
  "Ref",
  "RegExp",
  "String",
  "Symbol",
  "TemplateLiteral",
  "This",
  "Tuple",
  "Undefined",
  "Union",
  "Uint8Array",
  "Unknown",
  "Void"
];
function IsPattern(value) {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}
function IsControlCharacterFree(value) {
  if (!IsString(value))
    return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 7 && code <= 13 || code === 27 || code === 127) {
      return false;
    }
  }
  return true;
}
function IsAdditionalProperties(value) {
  return IsOptionalBoolean(value) || IsSchema2(value);
}
function IsOptionalBigInt(value) {
  return IsUndefined(value) || IsBigInt(value);
}
function IsOptionalNumber(value) {
  return IsUndefined(value) || IsNumber(value);
}
function IsOptionalBoolean(value) {
  return IsUndefined(value) || IsBoolean(value);
}
function IsOptionalString(value) {
  return IsUndefined(value) || IsString(value);
}
function IsOptionalPattern(value) {
  return IsUndefined(value) || IsString(value) && IsControlCharacterFree(value) && IsPattern(value);
}
function IsOptionalFormat(value) {
  return IsUndefined(value) || IsString(value) && IsControlCharacterFree(value);
}
function IsOptionalSchema(value) {
  return IsUndefined(value) || IsSchema2(value);
}
function IsReadonly2(value) {
  return IsObject(value) && value[ReadonlyKind] === "Readonly";
}
function IsOptional2(value) {
  return IsObject(value) && value[OptionalKind] === "Optional";
}
function IsAny2(value) {
  return IsKindOf2(value, "Any") && IsOptionalString(value.$id);
}
function IsArgument2(value) {
  return IsKindOf2(value, "Argument") && IsNumber(value.index);
}
function IsArray4(value) {
  return IsKindOf2(value, "Array") && value.type === "array" && IsOptionalString(value.$id) && IsSchema2(value.items) && IsOptionalNumber(value.minItems) && IsOptionalNumber(value.maxItems) && IsOptionalBoolean(value.uniqueItems) && IsOptionalSchema(value.contains) && IsOptionalNumber(value.minContains) && IsOptionalNumber(value.maxContains);
}
function IsAsyncIterator3(value) {
  return IsKindOf2(value, "AsyncIterator") && value.type === "AsyncIterator" && IsOptionalString(value.$id) && IsSchema2(value.items);
}
function IsBigInt3(value) {
  return IsKindOf2(value, "BigInt") && value.type === "bigint" && IsOptionalString(value.$id) && IsOptionalBigInt(value.exclusiveMaximum) && IsOptionalBigInt(value.exclusiveMinimum) && IsOptionalBigInt(value.maximum) && IsOptionalBigInt(value.minimum) && IsOptionalBigInt(value.multipleOf);
}
function IsBoolean3(value) {
  return IsKindOf2(value, "Boolean") && value.type === "boolean" && IsOptionalString(value.$id);
}
function IsComputed2(value) {
  return IsKindOf2(value, "Computed") && IsString(value.target) && IsArray(value.parameters) && value.parameters.every((schema) => IsSchema2(schema));
}
function IsConstructor2(value) {
  return IsKindOf2(value, "Constructor") && value.type === "Constructor" && IsOptionalString(value.$id) && IsArray(value.parameters) && value.parameters.every((schema) => IsSchema2(schema)) && IsSchema2(value.returns);
}
function IsDate3(value) {
  return IsKindOf2(value, "Date") && value.type === "Date" && IsOptionalString(value.$id) && IsOptionalNumber(value.exclusiveMaximumTimestamp) && IsOptionalNumber(value.exclusiveMinimumTimestamp) && IsOptionalNumber(value.maximumTimestamp) && IsOptionalNumber(value.minimumTimestamp) && IsOptionalNumber(value.multipleOfTimestamp);
}
function IsFunction3(value) {
  return IsKindOf2(value, "Function") && value.type === "Function" && IsOptionalString(value.$id) && IsArray(value.parameters) && value.parameters.every((schema) => IsSchema2(schema)) && IsSchema2(value.returns);
}
function IsImport(value) {
  return IsKindOf2(value, "Import") && HasPropertyKey(value, "$defs") && IsObject(value.$defs) && IsProperties(value.$defs) && HasPropertyKey(value, "$ref") && IsString(value.$ref) && value.$ref in value.$defs;
}
function IsInteger2(value) {
  return IsKindOf2(value, "Integer") && value.type === "integer" && IsOptionalString(value.$id) && IsOptionalNumber(value.exclusiveMaximum) && IsOptionalNumber(value.exclusiveMinimum) && IsOptionalNumber(value.maximum) && IsOptionalNumber(value.minimum) && IsOptionalNumber(value.multipleOf);
}
function IsProperties(value) {
  return IsObject(value) && Object.entries(value).every(([key, schema]) => IsControlCharacterFree(key) && IsSchema2(schema));
}
function IsIntersect2(value) {
  return IsKindOf2(value, "Intersect") && (IsString(value.type) && value.type !== "object" ? false : true) && IsArray(value.allOf) && value.allOf.every((schema) => IsSchema2(schema) && !IsTransform2(schema)) && IsOptionalString(value.type) && (IsOptionalBoolean(value.unevaluatedProperties) || IsOptionalSchema(value.unevaluatedProperties)) && IsOptionalString(value.$id);
}
function IsIterator3(value) {
  return IsKindOf2(value, "Iterator") && value.type === "Iterator" && IsOptionalString(value.$id) && IsSchema2(value.items);
}
function IsKindOf2(value, kind) {
  return IsObject(value) && Kind in value && value[Kind] === kind;
}
function IsLiteralString(value) {
  return IsLiteral2(value) && IsString(value.const);
}
function IsLiteralNumber(value) {
  return IsLiteral2(value) && IsNumber(value.const);
}
function IsLiteralBoolean(value) {
  return IsLiteral2(value) && IsBoolean(value.const);
}
function IsLiteral2(value) {
  return IsKindOf2(value, "Literal") && IsOptionalString(value.$id) && IsLiteralValue2(value.const);
}
function IsLiteralValue2(value) {
  return IsBoolean(value) || IsNumber(value) || IsString(value);
}
function IsMappedKey2(value) {
  return IsKindOf2(value, "MappedKey") && IsArray(value.keys) && value.keys.every((key) => IsNumber(key) || IsString(key));
}
function IsMappedResult2(value) {
  return IsKindOf2(value, "MappedResult") && IsProperties(value.properties);
}
function IsNever2(value) {
  return IsKindOf2(value, "Never") && IsObject(value.not) && Object.getOwnPropertyNames(value.not).length === 0;
}
function IsNot2(value) {
  return IsKindOf2(value, "Not") && IsSchema2(value.not);
}
function IsNull3(value) {
  return IsKindOf2(value, "Null") && value.type === "null" && IsOptionalString(value.$id);
}
function IsNumber4(value) {
  return IsKindOf2(value, "Number") && value.type === "number" && IsOptionalString(value.$id) && IsOptionalNumber(value.exclusiveMaximum) && IsOptionalNumber(value.exclusiveMinimum) && IsOptionalNumber(value.maximum) && IsOptionalNumber(value.minimum) && IsOptionalNumber(value.multipleOf);
}
function IsObject4(value) {
  return IsKindOf2(value, "Object") && value.type === "object" && IsOptionalString(value.$id) && IsProperties(value.properties) && IsAdditionalProperties(value.additionalProperties) && IsOptionalNumber(value.minProperties) && IsOptionalNumber(value.maxProperties);
}
function IsPromise2(value) {
  return IsKindOf2(value, "Promise") && value.type === "Promise" && IsOptionalString(value.$id) && IsSchema2(value.item);
}
function IsRecord2(value) {
  return IsKindOf2(value, "Record") && value.type === "object" && IsOptionalString(value.$id) && IsAdditionalProperties(value.additionalProperties) && IsObject(value.patternProperties) && ((schema) => {
    const keys = Object.getOwnPropertyNames(schema.patternProperties);
    return keys.length === 1 && IsPattern(keys[0]) && IsObject(schema.patternProperties) && IsSchema2(schema.patternProperties[keys[0]]);
  })(value);
}
function IsRecursive(value) {
  return IsObject(value) && Hint in value && value[Hint] === "Recursive";
}
function IsRef2(value) {
  return IsKindOf2(value, "Ref") && IsOptionalString(value.$id) && IsString(value.$ref);
}
function IsRegExp3(value) {
  return IsKindOf2(value, "RegExp") && IsOptionalString(value.$id) && IsString(value.source) && IsString(value.flags) && IsOptionalNumber(value.maxLength) && IsOptionalNumber(value.minLength);
}
function IsString3(value) {
  return IsKindOf2(value, "String") && value.type === "string" && IsOptionalString(value.$id) && IsOptionalNumber(value.minLength) && IsOptionalNumber(value.maxLength) && IsOptionalPattern(value.pattern) && IsOptionalFormat(value.format);
}
function IsSymbol3(value) {
  return IsKindOf2(value, "Symbol") && value.type === "symbol" && IsOptionalString(value.$id);
}
function IsTemplateLiteral2(value) {
  return IsKindOf2(value, "TemplateLiteral") && value.type === "string" && IsString(value.pattern) && value.pattern[0] === "^" && value.pattern[value.pattern.length - 1] === "$";
}
function IsThis2(value) {
  return IsKindOf2(value, "This") && IsOptionalString(value.$id) && IsString(value.$ref);
}
function IsTransform2(value) {
  return IsObject(value) && TransformKind in value;
}
function IsTuple2(value) {
  return IsKindOf2(value, "Tuple") && value.type === "array" && IsOptionalString(value.$id) && IsNumber(value.minItems) && IsNumber(value.maxItems) && value.minItems === value.maxItems && // empty
  (IsUndefined(value.items) && IsUndefined(value.additionalItems) && value.minItems === 0 || IsArray(value.items) && value.items.every((schema) => IsSchema2(schema)));
}
function IsUndefined4(value) {
  return IsKindOf2(value, "Undefined") && value.type === "undefined" && IsOptionalString(value.$id);
}
function IsUnionLiteral(value) {
  return IsUnion2(value) && value.anyOf.every((schema) => IsLiteralString(schema) || IsLiteralNumber(schema));
}
function IsUnion2(value) {
  return IsKindOf2(value, "Union") && IsOptionalString(value.$id) && IsObject(value) && IsArray(value.anyOf) && value.anyOf.every((schema) => IsSchema2(schema));
}
function IsUint8Array3(value) {
  return IsKindOf2(value, "Uint8Array") && value.type === "Uint8Array" && IsOptionalString(value.$id) && IsOptionalNumber(value.minByteLength) && IsOptionalNumber(value.maxByteLength);
}
function IsUnknown2(value) {
  return IsKindOf2(value, "Unknown") && IsOptionalString(value.$id);
}
function IsUnsafe2(value) {
  return IsKindOf2(value, "Unsafe");
}
function IsVoid2(value) {
  return IsKindOf2(value, "Void") && value.type === "void" && IsOptionalString(value.$id);
}
function IsKind2(value) {
  return IsObject(value) && Kind in value && IsString(value[Kind]) && !KnownTypes.includes(value[Kind]);
}
function IsSchema2(value) {
  return IsObject(value) && (IsAny2(value) || IsArgument2(value) || IsArray4(value) || IsBoolean3(value) || IsBigInt3(value) || IsAsyncIterator3(value) || IsComputed2(value) || IsConstructor2(value) || IsDate3(value) || IsFunction3(value) || IsInteger2(value) || IsIntersect2(value) || IsIterator3(value) || IsLiteral2(value) || IsMappedKey2(value) || IsMappedResult2(value) || IsNever2(value) || IsNot2(value) || IsNull3(value) || IsNumber4(value) || IsObject4(value) || IsPromise2(value) || IsRecord2(value) || IsRef2(value) || IsRegExp3(value) || IsString3(value) || IsSymbol3(value) || IsTemplateLiteral2(value) || IsThis2(value) || IsTuple2(value) || IsUndefined4(value) || IsUnion2(value) || IsUint8Array3(value) || IsUnknown2(value) || IsUnsafe2(value) || IsVoid2(value) || IsKind2(value));
}

// node_modules/@sinclair/typebox/build/esm/type/patterns/patterns.mjs
var PatternBoolean = "(true|false)";
var PatternNumber = "(0|[1-9][0-9]*)";
var PatternString = "(.*)";
var PatternNever = "(?!.*)";
var PatternBooleanExact = `^${PatternBoolean}$`;
var PatternNumberExact = `^${PatternNumber}$`;
var PatternStringExact = `^${PatternString}$`;
var PatternNeverExact = `^${PatternNever}$`;

// node_modules/@sinclair/typebox/build/esm/type/sets/set.mjs
function SetIncludes(T, S) {
  return T.includes(S);
}
function SetDistinct(T) {
  return [...new Set(T)];
}
function SetIntersect(T, S) {
  return T.filter((L) => S.includes(L));
}
function SetIntersectManyResolve(T, Init) {
  return T.reduce((Acc, L) => {
    return SetIntersect(Acc, L);
  }, Init);
}
function SetIntersectMany(T) {
  return T.length === 1 ? T[0] : T.length > 1 ? SetIntersectManyResolve(T.slice(1), T[0]) : [];
}
function SetUnionMany(T) {
  const Acc = [];
  for (const L of T)
    Acc.push(...L);
  return Acc;
}

// node_modules/@sinclair/typebox/build/esm/type/any/any.mjs
function Any(options) {
  return CreateType({ [Kind]: "Any" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/array/array.mjs
function Array2(items, options) {
  return CreateType({ [Kind]: "Array", type: "array", items }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/argument/argument.mjs
function Argument(index) {
  return CreateType({ [Kind]: "Argument", index });
}

// node_modules/@sinclair/typebox/build/esm/type/async-iterator/async-iterator.mjs
function AsyncIterator(items, options) {
  return CreateType({ [Kind]: "AsyncIterator", type: "AsyncIterator", items }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/computed/computed.mjs
function Computed(target, parameters, options) {
  return CreateType({ [Kind]: "Computed", target, parameters }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/discard/discard.mjs
function DiscardKey(value, key) {
  const { [key]: _, ...rest } = value;
  return rest;
}
function Discard(value, keys) {
  return keys.reduce((acc, key) => DiscardKey(acc, key), value);
}

// node_modules/@sinclair/typebox/build/esm/type/never/never.mjs
function Never(options) {
  return CreateType({ [Kind]: "Never", not: {} }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/mapped/mapped-result.mjs
function MappedResult(properties) {
  return CreateType({
    [Kind]: "MappedResult",
    properties
  });
}

// node_modules/@sinclair/typebox/build/esm/type/constructor/constructor.mjs
function Constructor(parameters, returns, options) {
  return CreateType({ [Kind]: "Constructor", type: "Constructor", parameters, returns }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/function/function.mjs
function Function(parameters, returns, options) {
  return CreateType({ [Kind]: "Function", type: "Function", parameters, returns }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/union/union-create.mjs
function UnionCreate(T, options) {
  return CreateType({ [Kind]: "Union", anyOf: T }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/union/union-evaluated.mjs
function IsUnionOptional(types) {
  return types.some((type) => IsOptional(type));
}
function RemoveOptionalFromRest(types) {
  return types.map((left) => IsOptional(left) ? RemoveOptionalFromType(left) : left);
}
function RemoveOptionalFromType(T) {
  return Discard(T, [OptionalKind]);
}
function ResolveUnion(types, options) {
  const isOptional = IsUnionOptional(types);
  return isOptional ? Optional(UnionCreate(RemoveOptionalFromRest(types), options)) : UnionCreate(RemoveOptionalFromRest(types), options);
}
function UnionEvaluated(T, options) {
  return T.length === 1 ? CreateType(T[0], options) : T.length === 0 ? Never(options) : ResolveUnion(T, options);
}

// node_modules/@sinclair/typebox/build/esm/type/union/union.mjs
function Union(types, options) {
  return types.length === 0 ? Never(options) : types.length === 1 ? CreateType(types[0], options) : UnionCreate(types, options);
}

// node_modules/@sinclair/typebox/build/esm/type/template-literal/parse.mjs
var TemplateLiteralParserError = class extends TypeBoxError {
};
function Unescape(pattern) {
  return pattern.replace(/\\\$/g, "$").replace(/\\\*/g, "*").replace(/\\\^/g, "^").replace(/\\\|/g, "|").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
}
function IsNonEscaped(pattern, index, char) {
  return pattern[index] === char && pattern.charCodeAt(index - 1) !== 92;
}
function IsOpenParen(pattern, index) {
  return IsNonEscaped(pattern, index, "(");
}
function IsCloseParen(pattern, index) {
  return IsNonEscaped(pattern, index, ")");
}
function IsSeparator(pattern, index) {
  return IsNonEscaped(pattern, index, "|");
}
function IsGroup(pattern) {
  if (!(IsOpenParen(pattern, 0) && IsCloseParen(pattern, pattern.length - 1)))
    return false;
  let count = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      count += 1;
    if (IsCloseParen(pattern, index))
      count -= 1;
    if (count === 0 && index !== pattern.length - 1)
      return false;
  }
  return true;
}
function InGroup(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function IsPrecedenceOr(pattern) {
  let count = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      count += 1;
    if (IsCloseParen(pattern, index))
      count -= 1;
    if (IsSeparator(pattern, index) && count === 0)
      return true;
  }
  return false;
}
function IsPrecedenceAnd(pattern) {
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      return true;
  }
  return false;
}
function Or(pattern) {
  let [count, start] = [0, 0];
  const expressions = [];
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      count += 1;
    if (IsCloseParen(pattern, index))
      count -= 1;
    if (IsSeparator(pattern, index) && count === 0) {
      const range2 = pattern.slice(start, index);
      if (range2.length > 0)
        expressions.push(TemplateLiteralParse(range2));
      start = index + 1;
    }
  }
  const range = pattern.slice(start);
  if (range.length > 0)
    expressions.push(TemplateLiteralParse(range));
  if (expressions.length === 0)
    return { type: "const", const: "" };
  if (expressions.length === 1)
    return expressions[0];
  return { type: "or", expr: expressions };
}
function And(pattern) {
  function Group(value, index) {
    if (!IsOpenParen(value, index))
      throw new TemplateLiteralParserError(`TemplateLiteralParser: Index must point to open parens`);
    let count = 0;
    for (let scan = index; scan < value.length; scan++) {
      if (IsOpenParen(value, scan))
        count += 1;
      if (IsCloseParen(value, scan))
        count -= 1;
      if (count === 0)
        return [index, scan];
    }
    throw new TemplateLiteralParserError(`TemplateLiteralParser: Unclosed group parens in expression`);
  }
  function Range(pattern2, index) {
    for (let scan = index; scan < pattern2.length; scan++) {
      if (IsOpenParen(pattern2, scan))
        return [index, scan];
    }
    return [index, pattern2.length];
  }
  const expressions = [];
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index)) {
      const [start, end] = Group(pattern, index);
      const range = pattern.slice(start, end + 1);
      expressions.push(TemplateLiteralParse(range));
      index = end;
    } else {
      const [start, end] = Range(pattern, index);
      const range = pattern.slice(start, end);
      if (range.length > 0)
        expressions.push(TemplateLiteralParse(range));
      index = end - 1;
    }
  }
  return expressions.length === 0 ? { type: "const", const: "" } : expressions.length === 1 ? expressions[0] : { type: "and", expr: expressions };
}
function TemplateLiteralParse(pattern) {
  return IsGroup(pattern) ? TemplateLiteralParse(InGroup(pattern)) : IsPrecedenceOr(pattern) ? Or(pattern) : IsPrecedenceAnd(pattern) ? And(pattern) : { type: "const", const: Unescape(pattern) };
}
function TemplateLiteralParseExact(pattern) {
  return TemplateLiteralParse(pattern.slice(1, pattern.length - 1));
}

// node_modules/@sinclair/typebox/build/esm/type/template-literal/finite.mjs
var TemplateLiteralFiniteError = class extends TypeBoxError {
};
function IsNumberExpression(expression) {
  return expression.type === "or" && expression.expr.length === 2 && expression.expr[0].type === "const" && expression.expr[0].const === "0" && expression.expr[1].type === "const" && expression.expr[1].const === "[1-9][0-9]*";
}
function IsBooleanExpression(expression) {
  return expression.type === "or" && expression.expr.length === 2 && expression.expr[0].type === "const" && expression.expr[0].const === "true" && expression.expr[1].type === "const" && expression.expr[1].const === "false";
}
function IsStringExpression(expression) {
  return expression.type === "const" && expression.const === ".*";
}
function IsTemplateLiteralExpressionFinite(expression) {
  return IsNumberExpression(expression) || IsStringExpression(expression) ? false : IsBooleanExpression(expression) ? true : expression.type === "and" ? expression.expr.every((expr) => IsTemplateLiteralExpressionFinite(expr)) : expression.type === "or" ? expression.expr.every((expr) => IsTemplateLiteralExpressionFinite(expr)) : expression.type === "const" ? true : (() => {
    throw new TemplateLiteralFiniteError(`Unknown expression type`);
  })();
}
function IsTemplateLiteralFinite(schema) {
  const expression = TemplateLiteralParseExact(schema.pattern);
  return IsTemplateLiteralExpressionFinite(expression);
}

// node_modules/@sinclair/typebox/build/esm/type/template-literal/generate.mjs
var TemplateLiteralGenerateError = class extends TypeBoxError {
};
function* GenerateReduce(buffer) {
  if (buffer.length === 1)
    return yield* buffer[0];
  for (const left of buffer[0]) {
    for (const right of GenerateReduce(buffer.slice(1))) {
      yield `${left}${right}`;
    }
  }
}
function* GenerateAnd(expression) {
  return yield* GenerateReduce(expression.expr.map((expr) => [...TemplateLiteralExpressionGenerate(expr)]));
}
function* GenerateOr(expression) {
  for (const expr of expression.expr)
    yield* TemplateLiteralExpressionGenerate(expr);
}
function* GenerateConst(expression) {
  return yield expression.const;
}
function* TemplateLiteralExpressionGenerate(expression) {
  return expression.type === "and" ? yield* GenerateAnd(expression) : expression.type === "or" ? yield* GenerateOr(expression) : expression.type === "const" ? yield* GenerateConst(expression) : (() => {
    throw new TemplateLiteralGenerateError("Unknown expression");
  })();
}
function TemplateLiteralGenerate(schema) {
  const expression = TemplateLiteralParseExact(schema.pattern);
  return IsTemplateLiteralExpressionFinite(expression) ? [...TemplateLiteralExpressionGenerate(expression)] : [];
}

// node_modules/@sinclair/typebox/build/esm/type/literal/literal.mjs
function Literal(value, options) {
  return CreateType({
    [Kind]: "Literal",
    const: value,
    type: typeof value
  }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/boolean/boolean.mjs
function Boolean2(options) {
  return CreateType({ [Kind]: "Boolean", type: "boolean" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/bigint/bigint.mjs
function BigInt(options) {
  return CreateType({ [Kind]: "BigInt", type: "bigint" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/number/number.mjs
function Number2(options) {
  return CreateType({ [Kind]: "Number", type: "number" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/string/string.mjs
function String2(options) {
  return CreateType({ [Kind]: "String", type: "string" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/template-literal/syntax.mjs
function* FromUnion(syntax) {
  const trim = syntax.trim().replace(/"|'/g, "");
  return trim === "boolean" ? yield Boolean2() : trim === "number" ? yield Number2() : trim === "bigint" ? yield BigInt() : trim === "string" ? yield String2() : yield (() => {
    const literals = trim.split("|").map((literal) => Literal(literal.trim()));
    return literals.length === 0 ? Never() : literals.length === 1 ? literals[0] : UnionEvaluated(literals);
  })();
}
function* FromTerminal(syntax) {
  if (syntax[1] !== "{") {
    const L = Literal("$");
    const R = FromSyntax(syntax.slice(1));
    return yield* [L, ...R];
  }
  for (let i = 2; i < syntax.length; i++) {
    if (syntax[i] === "}") {
      const L = FromUnion(syntax.slice(2, i));
      const R = FromSyntax(syntax.slice(i + 1));
      return yield* [...L, ...R];
    }
  }
  yield Literal(syntax);
}
function* FromSyntax(syntax) {
  for (let i = 0; i < syntax.length; i++) {
    if (syntax[i] === "$") {
      const L = Literal(syntax.slice(0, i));
      const R = FromTerminal(syntax.slice(i));
      return yield* [L, ...R];
    }
  }
  yield Literal(syntax);
}
function TemplateLiteralSyntax(syntax) {
  return [...FromSyntax(syntax)];
}

// node_modules/@sinclair/typebox/build/esm/type/template-literal/pattern.mjs
var TemplateLiteralPatternError = class extends TypeBoxError {
};
function Escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Visit2(schema, acc) {
  return IsTemplateLiteral(schema) ? schema.pattern.slice(1, schema.pattern.length - 1) : IsUnion(schema) ? `(${schema.anyOf.map((schema2) => Visit2(schema2, acc)).join("|")})` : IsNumber3(schema) ? `${acc}${PatternNumber}` : IsInteger(schema) ? `${acc}${PatternNumber}` : IsBigInt2(schema) ? `${acc}${PatternNumber}` : IsString2(schema) ? `${acc}${PatternString}` : IsLiteral(schema) ? `${acc}${Escape(schema.const.toString())}` : IsBoolean2(schema) ? `${acc}${PatternBoolean}` : (() => {
    throw new TemplateLiteralPatternError(`Unexpected Kind '${schema[Kind]}'`);
  })();
}
function TemplateLiteralPattern(kinds) {
  return `^${kinds.map((schema) => Visit2(schema, "")).join("")}$`;
}

// node_modules/@sinclair/typebox/build/esm/type/template-literal/union.mjs
function TemplateLiteralToUnion(schema) {
  const R = TemplateLiteralGenerate(schema);
  const L = R.map((S) => Literal(S));
  return UnionEvaluated(L);
}

// node_modules/@sinclair/typebox/build/esm/type/template-literal/template-literal.mjs
function TemplateLiteral(unresolved, options) {
  const pattern = IsString(unresolved) ? TemplateLiteralPattern(TemplateLiteralSyntax(unresolved)) : TemplateLiteralPattern(unresolved);
  return CreateType({ [Kind]: "TemplateLiteral", type: "string", pattern }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-property-keys.mjs
function FromTemplateLiteral(templateLiteral) {
  const keys = TemplateLiteralGenerate(templateLiteral);
  return keys.map((key) => key.toString());
}
function FromUnion2(types) {
  const result = [];
  for (const type of types)
    result.push(...IndexPropertyKeys(type));
  return result;
}
function FromLiteral(literalValue) {
  return [literalValue.toString()];
}
function IndexPropertyKeys(type) {
  return [...new Set(IsTemplateLiteral(type) ? FromTemplateLiteral(type) : IsUnion(type) ? FromUnion2(type.anyOf) : IsLiteral(type) ? FromLiteral(type.const) : IsNumber3(type) ? ["[number]"] : IsInteger(type) ? ["[number]"] : [])];
}

// node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-from-mapped-result.mjs
function FromProperties(type, properties, options) {
  const result = {};
  for (const K2 of Object.getOwnPropertyNames(properties)) {
    result[K2] = Index(type, IndexPropertyKeys(properties[K2]), options);
  }
  return result;
}
function FromMappedResult(type, mappedResult, options) {
  return FromProperties(type, mappedResult.properties, options);
}
function IndexFromMappedResult(type, mappedResult, options) {
  const properties = FromMappedResult(type, mappedResult, options);
  return MappedResult(properties);
}

// node_modules/@sinclair/typebox/build/esm/type/indexed/indexed.mjs
function FromRest(types, key) {
  return types.map((type) => IndexFromPropertyKey(type, key));
}
function FromIntersectRest(types) {
  return types.filter((type) => !IsNever(type));
}
function FromIntersect(types, key) {
  return IntersectEvaluated(FromIntersectRest(FromRest(types, key)));
}
function FromUnionRest(types) {
  return types.some((L) => IsNever(L)) ? [] : types;
}
function FromUnion3(types, key) {
  return UnionEvaluated(FromUnionRest(FromRest(types, key)));
}
function FromTuple(types, key) {
  return key in types ? types[key] : key === "[number]" ? UnionEvaluated(types) : Never();
}
function FromArray(type, key) {
  return key === "[number]" ? type : Never();
}
function FromProperty(properties, propertyKey) {
  return propertyKey in properties ? properties[propertyKey] : Never();
}
function IndexFromPropertyKey(type, propertyKey) {
  return IsIntersect(type) ? FromIntersect(type.allOf, propertyKey) : IsUnion(type) ? FromUnion3(type.anyOf, propertyKey) : IsTuple(type) ? FromTuple(type.items ?? [], propertyKey) : IsArray3(type) ? FromArray(type.items, propertyKey) : IsObject3(type) ? FromProperty(type.properties, propertyKey) : Never();
}
function IndexFromPropertyKeys(type, propertyKeys) {
  return propertyKeys.map((propertyKey) => IndexFromPropertyKey(type, propertyKey));
}
function FromSchema(type, propertyKeys) {
  return UnionEvaluated(IndexFromPropertyKeys(type, propertyKeys));
}
function Index(type, key, options) {
  if (IsRef(type) || IsRef(key)) {
    const error = `Index types using Ref parameters require both Type and Key to be of TSchema`;
    if (!IsSchema(type) || !IsSchema(key))
      throw new TypeBoxError(error);
    return Computed("Index", [type, key]);
  }
  if (IsMappedResult(key))
    return IndexFromMappedResult(type, key, options);
  if (IsMappedKey(key))
    return IndexFromMappedKey(type, key, options);
  return CreateType(IsSchema(key) ? FromSchema(type, IndexPropertyKeys(key)) : FromSchema(type, key), options);
}

// node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-from-mapped-key.mjs
function MappedIndexPropertyKey(type, key, options) {
  return { [key]: Index(type, [key], Clone(options)) };
}
function MappedIndexPropertyKeys(type, propertyKeys, options) {
  return propertyKeys.reduce((result, left) => {
    return { ...result, ...MappedIndexPropertyKey(type, left, options) };
  }, {});
}
function MappedIndexProperties(type, mappedKey, options) {
  return MappedIndexPropertyKeys(type, mappedKey.keys, options);
}
function IndexFromMappedKey(type, mappedKey, options) {
  const properties = MappedIndexProperties(type, mappedKey, options);
  return MappedResult(properties);
}

// node_modules/@sinclair/typebox/build/esm/type/iterator/iterator.mjs
function Iterator(items, options) {
  return CreateType({ [Kind]: "Iterator", type: "Iterator", items }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/object/object.mjs
function RequiredArray(properties) {
  return globalThis.Object.keys(properties).filter((key) => !IsOptional(properties[key]));
}
function _Object(properties, options) {
  const required = RequiredArray(properties);
  const schema = required.length > 0 ? { [Kind]: "Object", type: "object", required, properties } : { [Kind]: "Object", type: "object", properties };
  return CreateType(schema, options);
}
var Object2 = _Object;

// node_modules/@sinclair/typebox/build/esm/type/promise/promise.mjs
function Promise2(item, options) {
  return CreateType({ [Kind]: "Promise", type: "Promise", item }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/readonly/readonly.mjs
function RemoveReadonly(schema) {
  return CreateType(Discard(schema, [ReadonlyKind]));
}
function AddReadonly(schema) {
  return CreateType({ ...schema, [ReadonlyKind]: "Readonly" });
}
function ReadonlyWithFlag(schema, F) {
  return F === false ? RemoveReadonly(schema) : AddReadonly(schema);
}
function Readonly(schema, enable) {
  const F = enable ?? true;
  return IsMappedResult(schema) ? ReadonlyFromMappedResult(schema, F) : ReadonlyWithFlag(schema, F);
}

// node_modules/@sinclair/typebox/build/esm/type/readonly/readonly-from-mapped-result.mjs
function FromProperties2(K, F) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(K))
    Acc[K2] = Readonly(K[K2], F);
  return Acc;
}
function FromMappedResult2(R, F) {
  return FromProperties2(R.properties, F);
}
function ReadonlyFromMappedResult(R, F) {
  const P = FromMappedResult2(R, F);
  return MappedResult(P);
}

// node_modules/@sinclair/typebox/build/esm/type/tuple/tuple.mjs
function Tuple(types, options) {
  return CreateType(types.length > 0 ? { [Kind]: "Tuple", type: "array", items: types, additionalItems: false, minItems: types.length, maxItems: types.length } : { [Kind]: "Tuple", type: "array", minItems: types.length, maxItems: types.length }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/mapped/mapped.mjs
function FromMappedResult3(K, P) {
  return K in P ? FromSchemaType(K, P[K]) : MappedResult(P);
}
function MappedKeyToKnownMappedResultProperties(K) {
  return { [K]: Literal(K) };
}
function MappedKeyToUnknownMappedResultProperties(P) {
  const Acc = {};
  for (const L of P)
    Acc[L] = Literal(L);
  return Acc;
}
function MappedKeyToMappedResultProperties(K, P) {
  return SetIncludes(P, K) ? MappedKeyToKnownMappedResultProperties(K) : MappedKeyToUnknownMappedResultProperties(P);
}
function FromMappedKey(K, P) {
  const R = MappedKeyToMappedResultProperties(K, P);
  return FromMappedResult3(K, R);
}
function FromRest2(K, T) {
  return T.map((L) => FromSchemaType(K, L));
}
function FromProperties3(K, T) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(T))
    Acc[K2] = FromSchemaType(K, T[K2]);
  return Acc;
}
function FromSchemaType(K, T) {
  const options = { ...T };
  return (
    // unevaluated modifier types
    IsOptional(T) ? Optional(FromSchemaType(K, Discard(T, [OptionalKind]))) : IsReadonly(T) ? Readonly(FromSchemaType(K, Discard(T, [ReadonlyKind]))) : (
      // unevaluated mapped types
      IsMappedResult(T) ? FromMappedResult3(K, T.properties) : IsMappedKey(T) ? FromMappedKey(K, T.keys) : (
        // unevaluated types
        IsConstructor(T) ? Constructor(FromRest2(K, T.parameters), FromSchemaType(K, T.returns), options) : IsFunction2(T) ? Function(FromRest2(K, T.parameters), FromSchemaType(K, T.returns), options) : IsAsyncIterator2(T) ? AsyncIterator(FromSchemaType(K, T.items), options) : IsIterator2(T) ? Iterator(FromSchemaType(K, T.items), options) : IsIntersect(T) ? Intersect(FromRest2(K, T.allOf), options) : IsUnion(T) ? Union(FromRest2(K, T.anyOf), options) : IsTuple(T) ? Tuple(FromRest2(K, T.items ?? []), options) : IsObject3(T) ? Object2(FromProperties3(K, T.properties), options) : IsArray3(T) ? Array2(FromSchemaType(K, T.items), options) : IsPromise(T) ? Promise2(FromSchemaType(K, T.item), options) : T
      )
    )
  );
}
function MappedFunctionReturnType(K, T) {
  const Acc = {};
  for (const L of K)
    Acc[L] = FromSchemaType(L, T);
  return Acc;
}
function Mapped(key, map, options) {
  const K = IsSchema(key) ? IndexPropertyKeys(key) : key;
  const RT = map({ [Kind]: "MappedKey", keys: K });
  const R = MappedFunctionReturnType(K, RT);
  return Object2(R, options);
}

// node_modules/@sinclair/typebox/build/esm/type/optional/optional.mjs
function RemoveOptional(schema) {
  return CreateType(Discard(schema, [OptionalKind]));
}
function AddOptional(schema) {
  return CreateType({ ...schema, [OptionalKind]: "Optional" });
}
function OptionalWithFlag(schema, F) {
  return F === false ? RemoveOptional(schema) : AddOptional(schema);
}
function Optional(schema, enable) {
  const F = enable ?? true;
  return IsMappedResult(schema) ? OptionalFromMappedResult(schema, F) : OptionalWithFlag(schema, F);
}

// node_modules/@sinclair/typebox/build/esm/type/optional/optional-from-mapped-result.mjs
function FromProperties4(P, F) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Optional(P[K2], F);
  return Acc;
}
function FromMappedResult4(R, F) {
  return FromProperties4(R.properties, F);
}
function OptionalFromMappedResult(R, F) {
  const P = FromMappedResult4(R, F);
  return MappedResult(P);
}

// node_modules/@sinclair/typebox/build/esm/type/intersect/intersect-create.mjs
function IntersectCreate(T, options = {}) {
  const allObjects = T.every((schema) => IsObject3(schema));
  const clonedUnevaluatedProperties = IsSchema(options.unevaluatedProperties) ? { unevaluatedProperties: options.unevaluatedProperties } : {};
  return CreateType(options.unevaluatedProperties === false || IsSchema(options.unevaluatedProperties) || allObjects ? { ...clonedUnevaluatedProperties, [Kind]: "Intersect", type: "object", allOf: T } : { ...clonedUnevaluatedProperties, [Kind]: "Intersect", allOf: T }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/intersect/intersect-evaluated.mjs
function IsIntersectOptional(types) {
  return types.every((left) => IsOptional(left));
}
function RemoveOptionalFromType2(type) {
  return Discard(type, [OptionalKind]);
}
function RemoveOptionalFromRest2(types) {
  return types.map((left) => IsOptional(left) ? RemoveOptionalFromType2(left) : left);
}
function ResolveIntersect(types, options) {
  return IsIntersectOptional(types) ? Optional(IntersectCreate(RemoveOptionalFromRest2(types), options)) : IntersectCreate(RemoveOptionalFromRest2(types), options);
}
function IntersectEvaluated(types, options = {}) {
  if (types.length === 1)
    return CreateType(types[0], options);
  if (types.length === 0)
    return Never(options);
  if (types.some((schema) => IsTransform(schema)))
    throw new Error("Cannot intersect transform types");
  return ResolveIntersect(types, options);
}

// node_modules/@sinclair/typebox/build/esm/type/intersect/intersect.mjs
function Intersect(types, options) {
  if (types.length === 1)
    return CreateType(types[0], options);
  if (types.length === 0)
    return Never(options);
  if (types.some((schema) => IsTransform(schema)))
    throw new Error("Cannot intersect transform types");
  return IntersectCreate(types, options);
}

// node_modules/@sinclair/typebox/build/esm/type/ref/ref.mjs
function Ref(...args) {
  const [$ref, options] = typeof args[0] === "string" ? [args[0], args[1]] : [args[0].$id, args[1]];
  if (typeof $ref !== "string")
    throw new TypeBoxError("Ref: $ref must be a string");
  return CreateType({ [Kind]: "Ref", $ref }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/awaited/awaited.mjs
function FromComputed(target, parameters) {
  return Computed("Awaited", [Computed(target, parameters)]);
}
function FromRef($ref) {
  return Computed("Awaited", [Ref($ref)]);
}
function FromIntersect2(types) {
  return Intersect(FromRest3(types));
}
function FromUnion4(types) {
  return Union(FromRest3(types));
}
function FromPromise(type) {
  return Awaited(type);
}
function FromRest3(types) {
  return types.map((type) => Awaited(type));
}
function Awaited(type, options) {
  return CreateType(IsComputed(type) ? FromComputed(type.target, type.parameters) : IsIntersect(type) ? FromIntersect2(type.allOf) : IsUnion(type) ? FromUnion4(type.anyOf) : IsPromise(type) ? FromPromise(type.item) : IsRef(type) ? FromRef(type.$ref) : type, options);
}

// node_modules/@sinclair/typebox/build/esm/type/keyof/keyof-property-keys.mjs
function FromRest4(types) {
  const result = [];
  for (const L of types)
    result.push(KeyOfPropertyKeys(L));
  return result;
}
function FromIntersect3(types) {
  const propertyKeysArray = FromRest4(types);
  const propertyKeys = SetUnionMany(propertyKeysArray);
  return propertyKeys;
}
function FromUnion5(types) {
  const propertyKeysArray = FromRest4(types);
  const propertyKeys = SetIntersectMany(propertyKeysArray);
  return propertyKeys;
}
function FromTuple2(types) {
  return types.map((_, indexer) => indexer.toString());
}
function FromArray2(_) {
  return ["[number]"];
}
function FromProperties5(T) {
  return globalThis.Object.getOwnPropertyNames(T);
}
function FromPatternProperties(patternProperties) {
  if (!includePatternProperties)
    return [];
  const patternPropertyKeys = globalThis.Object.getOwnPropertyNames(patternProperties);
  return patternPropertyKeys.map((key) => {
    return key[0] === "^" && key[key.length - 1] === "$" ? key.slice(1, key.length - 1) : key;
  });
}
function KeyOfPropertyKeys(type) {
  return IsIntersect(type) ? FromIntersect3(type.allOf) : IsUnion(type) ? FromUnion5(type.anyOf) : IsTuple(type) ? FromTuple2(type.items ?? []) : IsArray3(type) ? FromArray2(type.items) : IsObject3(type) ? FromProperties5(type.properties) : IsRecord(type) ? FromPatternProperties(type.patternProperties) : [];
}
var includePatternProperties = false;

// node_modules/@sinclair/typebox/build/esm/type/keyof/keyof.mjs
function FromComputed2(target, parameters) {
  return Computed("KeyOf", [Computed(target, parameters)]);
}
function FromRef2($ref) {
  return Computed("KeyOf", [Ref($ref)]);
}
function KeyOfFromType(type, options) {
  const propertyKeys = KeyOfPropertyKeys(type);
  const propertyKeyTypes = KeyOfPropertyKeysToRest(propertyKeys);
  const result = UnionEvaluated(propertyKeyTypes);
  return CreateType(result, options);
}
function KeyOfPropertyKeysToRest(propertyKeys) {
  return propertyKeys.map((L) => L === "[number]" ? Number2() : Literal(L));
}
function KeyOf(type, options) {
  return IsComputed(type) ? FromComputed2(type.target, type.parameters) : IsRef(type) ? FromRef2(type.$ref) : IsMappedResult(type) ? KeyOfFromMappedResult(type, options) : KeyOfFromType(type, options);
}

// node_modules/@sinclair/typebox/build/esm/type/keyof/keyof-from-mapped-result.mjs
function FromProperties6(properties, options) {
  const result = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(properties))
    result[K2] = KeyOf(properties[K2], Clone(options));
  return result;
}
function FromMappedResult5(mappedResult, options) {
  return FromProperties6(mappedResult.properties, options);
}
function KeyOfFromMappedResult(mappedResult, options) {
  const properties = FromMappedResult5(mappedResult, options);
  return MappedResult(properties);
}

// node_modules/@sinclair/typebox/build/esm/type/composite/composite.mjs
function CompositeKeys(T) {
  const Acc = [];
  for (const L of T)
    Acc.push(...KeyOfPropertyKeys(L));
  return SetDistinct(Acc);
}
function FilterNever(T) {
  return T.filter((L) => !IsNever(L));
}
function CompositeProperty(T, K) {
  const Acc = [];
  for (const L of T)
    Acc.push(...IndexFromPropertyKeys(L, [K]));
  return FilterNever(Acc);
}
function CompositeProperties(T, K) {
  const Acc = {};
  for (const L of K) {
    Acc[L] = IntersectEvaluated(CompositeProperty(T, L));
  }
  return Acc;
}
function Composite(T, options) {
  const K = CompositeKeys(T);
  const P = CompositeProperties(T, K);
  const R = Object2(P, options);
  return R;
}

// node_modules/@sinclair/typebox/build/esm/type/date/date.mjs
function Date2(options) {
  return CreateType({ [Kind]: "Date", type: "Date" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/null/null.mjs
function Null(options) {
  return CreateType({ [Kind]: "Null", type: "null" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/symbol/symbol.mjs
function Symbol2(options) {
  return CreateType({ [Kind]: "Symbol", type: "symbol" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/undefined/undefined.mjs
function Undefined(options) {
  return CreateType({ [Kind]: "Undefined", type: "undefined" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/uint8array/uint8array.mjs
function Uint8Array2(options) {
  return CreateType({ [Kind]: "Uint8Array", type: "Uint8Array" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/unknown/unknown.mjs
function Unknown(options) {
  return CreateType({ [Kind]: "Unknown" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/const/const.mjs
function FromArray3(T) {
  return T.map((L) => FromValue(L, false));
}
function FromProperties7(value) {
  const Acc = {};
  for (const K of globalThis.Object.getOwnPropertyNames(value))
    Acc[K] = Readonly(FromValue(value[K], false));
  return Acc;
}
function ConditionalReadonly(T, root) {
  return root === true ? T : Readonly(T);
}
function FromValue(value, root) {
  return IsAsyncIterator(value) ? ConditionalReadonly(Any(), root) : IsIterator(value) ? ConditionalReadonly(Any(), root) : IsArray(value) ? Readonly(Tuple(FromArray3(value))) : IsUint8Array(value) ? Uint8Array2() : IsDate(value) ? Date2() : IsObject(value) ? ConditionalReadonly(Object2(FromProperties7(value)), root) : IsFunction(value) ? ConditionalReadonly(Function([], Unknown()), root) : IsUndefined(value) ? Undefined() : IsNull(value) ? Null() : IsSymbol(value) ? Symbol2() : IsBigInt(value) ? BigInt() : IsNumber(value) ? Literal(value) : IsBoolean(value) ? Literal(value) : IsString(value) ? Literal(value) : Object2({});
}
function Const(T, options) {
  return CreateType(FromValue(T, true), options);
}

// node_modules/@sinclair/typebox/build/esm/type/constructor-parameters/constructor-parameters.mjs
function ConstructorParameters(schema, options) {
  return IsConstructor(schema) ? Tuple(schema.parameters, options) : Never(options);
}

// node_modules/@sinclair/typebox/build/esm/type/enum/enum.mjs
function Enum(item, options) {
  if (IsUndefined(item))
    throw new Error("Enum undefined or empty");
  const values1 = globalThis.Object.getOwnPropertyNames(item).filter((key) => isNaN(key)).map((key) => item[key]);
  const values2 = [...new Set(values1)];
  const anyOf = values2.map((value) => Literal(value));
  return Union(anyOf, { ...options, [Hint]: "Enum" });
}

// node_modules/@sinclair/typebox/build/esm/type/extends/extends-check.mjs
var ExtendsResolverError = class extends TypeBoxError {
};
var ExtendsResult;
(function(ExtendsResult2) {
  ExtendsResult2[ExtendsResult2["Union"] = 0] = "Union";
  ExtendsResult2[ExtendsResult2["True"] = 1] = "True";
  ExtendsResult2[ExtendsResult2["False"] = 2] = "False";
})(ExtendsResult || (ExtendsResult = {}));
function IntoBooleanResult(result) {
  return result === ExtendsResult.False ? result : ExtendsResult.True;
}
function Throw(message) {
  throw new ExtendsResolverError(message);
}
function IsStructuralRight(right) {
  return type_exports.IsNever(right) || type_exports.IsIntersect(right) || type_exports.IsUnion(right) || type_exports.IsUnknown(right) || type_exports.IsAny(right);
}
function StructuralRight(left, right) {
  return type_exports.IsNever(right) ? FromNeverRight(left, right) : type_exports.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports.IsUnion(right) ? FromUnionRight(left, right) : type_exports.IsUnknown(right) ? FromUnknownRight(left, right) : type_exports.IsAny(right) ? FromAnyRight(left, right) : Throw("StructuralRight");
}
function FromAnyRight(left, right) {
  return ExtendsResult.True;
}
function FromAny(left, right) {
  return type_exports.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports.IsUnion(right) && right.anyOf.some((schema) => type_exports.IsAny(schema) || type_exports.IsUnknown(schema)) ? ExtendsResult.True : type_exports.IsUnion(right) ? ExtendsResult.Union : type_exports.IsUnknown(right) ? ExtendsResult.True : type_exports.IsAny(right) ? ExtendsResult.True : ExtendsResult.Union;
}
function FromArrayRight(left, right) {
  return type_exports.IsUnknown(left) ? ExtendsResult.False : type_exports.IsAny(left) ? ExtendsResult.Union : type_exports.IsNever(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromArray4(left, right) {
  return type_exports.IsObject(right) && IsObjectArrayLike(right) ? ExtendsResult.True : IsStructuralRight(right) ? StructuralRight(left, right) : !type_exports.IsArray(right) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.items, right.items));
}
function FromAsyncIterator(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : !type_exports.IsAsyncIterator(right) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.items, right.items));
}
function FromBigInt(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsBigInt(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromBooleanRight(left, right) {
  return type_exports.IsLiteralBoolean(left) ? ExtendsResult.True : type_exports.IsBoolean(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromBoolean(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsBoolean(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromConstructor(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : !type_exports.IsConstructor(right) ? ExtendsResult.False : left.parameters.length > right.parameters.length ? ExtendsResult.False : !left.parameters.every((schema, index) => IntoBooleanResult(Visit3(right.parameters[index], schema)) === ExtendsResult.True) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.returns, right.returns));
}
function FromDate(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsDate(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromFunction(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : !type_exports.IsFunction(right) ? ExtendsResult.False : left.parameters.length > right.parameters.length ? ExtendsResult.False : !left.parameters.every((schema, index) => IntoBooleanResult(Visit3(right.parameters[index], schema)) === ExtendsResult.True) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.returns, right.returns));
}
function FromIntegerRight(left, right) {
  return type_exports.IsLiteral(left) && value_exports.IsNumber(left.const) ? ExtendsResult.True : type_exports.IsNumber(left) || type_exports.IsInteger(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromInteger(left, right) {
  return type_exports.IsInteger(right) || type_exports.IsNumber(right) ? ExtendsResult.True : IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : ExtendsResult.False;
}
function FromIntersectRight(left, right) {
  return right.allOf.every((schema) => Visit3(left, schema) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromIntersect4(left, right) {
  return left.allOf.some((schema) => Visit3(schema, right) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromIterator(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : !type_exports.IsIterator(right) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.items, right.items));
}
function FromLiteral2(left, right) {
  return type_exports.IsLiteral(right) && right.const === left.const ? ExtendsResult.True : IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsString(right) ? FromStringRight(left, right) : type_exports.IsNumber(right) ? FromNumberRight(left, right) : type_exports.IsInteger(right) ? FromIntegerRight(left, right) : type_exports.IsBoolean(right) ? FromBooleanRight(left, right) : ExtendsResult.False;
}
function FromNeverRight(left, right) {
  return ExtendsResult.False;
}
function FromNever(left, right) {
  return ExtendsResult.True;
}
function UnwrapTNot(schema) {
  let [current, depth] = [schema, 0];
  while (true) {
    if (!type_exports.IsNot(current))
      break;
    current = current.not;
    depth += 1;
  }
  return depth % 2 === 0 ? current : Unknown();
}
function FromNot(left, right) {
  return type_exports.IsNot(left) ? Visit3(UnwrapTNot(left), right) : type_exports.IsNot(right) ? Visit3(left, UnwrapTNot(right)) : Throw("Invalid fallthrough for Not");
}
function FromNull(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsNull(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromNumberRight(left, right) {
  return type_exports.IsLiteralNumber(left) ? ExtendsResult.True : type_exports.IsNumber(left) || type_exports.IsInteger(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromNumber(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsInteger(right) || type_exports.IsNumber(right) ? ExtendsResult.True : ExtendsResult.False;
}
function IsObjectPropertyCount(schema, count) {
  return Object.getOwnPropertyNames(schema.properties).length === count;
}
function IsObjectStringLike(schema) {
  return IsObjectArrayLike(schema);
}
function IsObjectSymbolLike(schema) {
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "description" in schema.properties && type_exports.IsUnion(schema.properties.description) && schema.properties.description.anyOf.length === 2 && (type_exports.IsString(schema.properties.description.anyOf[0]) && type_exports.IsUndefined(schema.properties.description.anyOf[1]) || type_exports.IsString(schema.properties.description.anyOf[1]) && type_exports.IsUndefined(schema.properties.description.anyOf[0]));
}
function IsObjectNumberLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectBooleanLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectBigIntLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectDateLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectUint8ArrayLike(schema) {
  return IsObjectArrayLike(schema);
}
function IsObjectFunctionLike(schema) {
  const length = Number2();
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "length" in schema.properties && IntoBooleanResult(Visit3(schema.properties["length"], length)) === ExtendsResult.True;
}
function IsObjectConstructorLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectArrayLike(schema) {
  const length = Number2();
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "length" in schema.properties && IntoBooleanResult(Visit3(schema.properties["length"], length)) === ExtendsResult.True;
}
function IsObjectPromiseLike(schema) {
  const then = Function([Any()], Any());
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "then" in schema.properties && IntoBooleanResult(Visit3(schema.properties["then"], then)) === ExtendsResult.True;
}
function Property(left, right) {
  return Visit3(left, right) === ExtendsResult.False ? ExtendsResult.False : type_exports.IsOptional(left) && !type_exports.IsOptional(right) ? ExtendsResult.False : ExtendsResult.True;
}
function FromObjectRight(left, right) {
  return type_exports.IsUnknown(left) ? ExtendsResult.False : type_exports.IsAny(left) ? ExtendsResult.Union : type_exports.IsNever(left) || type_exports.IsLiteralString(left) && IsObjectStringLike(right) || type_exports.IsLiteralNumber(left) && IsObjectNumberLike(right) || type_exports.IsLiteralBoolean(left) && IsObjectBooleanLike(right) || type_exports.IsSymbol(left) && IsObjectSymbolLike(right) || type_exports.IsBigInt(left) && IsObjectBigIntLike(right) || type_exports.IsString(left) && IsObjectStringLike(right) || type_exports.IsSymbol(left) && IsObjectSymbolLike(right) || type_exports.IsNumber(left) && IsObjectNumberLike(right) || type_exports.IsInteger(left) && IsObjectNumberLike(right) || type_exports.IsBoolean(left) && IsObjectBooleanLike(right) || type_exports.IsUint8Array(left) && IsObjectUint8ArrayLike(right) || type_exports.IsDate(left) && IsObjectDateLike(right) || type_exports.IsConstructor(left) && IsObjectConstructorLike(right) || type_exports.IsFunction(left) && IsObjectFunctionLike(right) ? ExtendsResult.True : type_exports.IsRecord(left) && type_exports.IsString(RecordKey(left)) ? (() => {
    return right[Hint] === "Record" ? ExtendsResult.True : ExtendsResult.False;
  })() : type_exports.IsRecord(left) && type_exports.IsNumber(RecordKey(left)) ? (() => {
    return IsObjectPropertyCount(right, 0) ? ExtendsResult.True : ExtendsResult.False;
  })() : ExtendsResult.False;
}
function FromObject(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : !type_exports.IsObject(right) ? ExtendsResult.False : (() => {
    for (const key of Object.getOwnPropertyNames(right.properties)) {
      if (!(key in left.properties) && !type_exports.IsOptional(right.properties[key])) {
        return ExtendsResult.False;
      }
      if (type_exports.IsOptional(right.properties[key])) {
        return ExtendsResult.True;
      }
      if (Property(left.properties[key], right.properties[key]) === ExtendsResult.False) {
        return ExtendsResult.False;
      }
    }
    return ExtendsResult.True;
  })();
}
function FromPromise2(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) && IsObjectPromiseLike(right) ? ExtendsResult.True : !type_exports.IsPromise(right) ? ExtendsResult.False : IntoBooleanResult(Visit3(left.item, right.item));
}
function RecordKey(schema) {
  return PatternNumberExact in schema.patternProperties ? Number2() : PatternStringExact in schema.patternProperties ? String2() : Throw("Unknown record key pattern");
}
function RecordValue(schema) {
  return PatternNumberExact in schema.patternProperties ? schema.patternProperties[PatternNumberExact] : PatternStringExact in schema.patternProperties ? schema.patternProperties[PatternStringExact] : Throw("Unable to get record value schema");
}
function FromRecordRight(left, right) {
  const [Key, Value] = [RecordKey(right), RecordValue(right)];
  return type_exports.IsLiteralString(left) && type_exports.IsNumber(Key) && IntoBooleanResult(Visit3(left, Value)) === ExtendsResult.True ? ExtendsResult.True : type_exports.IsUint8Array(left) && type_exports.IsNumber(Key) ? Visit3(left, Value) : type_exports.IsString(left) && type_exports.IsNumber(Key) ? Visit3(left, Value) : type_exports.IsArray(left) && type_exports.IsNumber(Key) ? Visit3(left, Value) : type_exports.IsObject(left) ? (() => {
    for (const key of Object.getOwnPropertyNames(left.properties)) {
      if (Property(Value, left.properties[key]) === ExtendsResult.False) {
        return ExtendsResult.False;
      }
    }
    return ExtendsResult.True;
  })() : ExtendsResult.False;
}
function FromRecord(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : !type_exports.IsRecord(right) ? ExtendsResult.False : Visit3(RecordValue(left), RecordValue(right));
}
function FromRegExp(left, right) {
  const L = type_exports.IsRegExp(left) ? String2() : left;
  const R = type_exports.IsRegExp(right) ? String2() : right;
  return Visit3(L, R);
}
function FromStringRight(left, right) {
  return type_exports.IsLiteral(left) && value_exports.IsString(left.const) ? ExtendsResult.True : type_exports.IsString(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromString(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsString(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromSymbol(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsSymbol(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromTemplateLiteral2(left, right) {
  return type_exports.IsTemplateLiteral(left) ? Visit3(TemplateLiteralToUnion(left), right) : type_exports.IsTemplateLiteral(right) ? Visit3(left, TemplateLiteralToUnion(right)) : Throw("Invalid fallthrough for TemplateLiteral");
}
function IsArrayOfTuple(left, right) {
  return type_exports.IsArray(right) && left.items !== void 0 && left.items.every((schema) => Visit3(schema, right.items) === ExtendsResult.True);
}
function FromTupleRight(left, right) {
  return type_exports.IsNever(left) ? ExtendsResult.True : type_exports.IsUnknown(left) ? ExtendsResult.False : type_exports.IsAny(left) ? ExtendsResult.Union : ExtendsResult.False;
}
function FromTuple3(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) && IsObjectArrayLike(right) ? ExtendsResult.True : type_exports.IsArray(right) && IsArrayOfTuple(left, right) ? ExtendsResult.True : !type_exports.IsTuple(right) ? ExtendsResult.False : value_exports.IsUndefined(left.items) && !value_exports.IsUndefined(right.items) || !value_exports.IsUndefined(left.items) && value_exports.IsUndefined(right.items) ? ExtendsResult.False : value_exports.IsUndefined(left.items) && !value_exports.IsUndefined(right.items) ? ExtendsResult.True : left.items.every((schema, index) => Visit3(schema, right.items[index]) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUint8Array(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsUint8Array(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUndefined(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsRecord(right) ? FromRecordRight(left, right) : type_exports.IsVoid(right) ? FromVoidRight(left, right) : type_exports.IsUndefined(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUnionRight(left, right) {
  return right.anyOf.some((schema) => Visit3(left, schema) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUnion6(left, right) {
  return left.anyOf.every((schema) => Visit3(schema, right) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUnknownRight(left, right) {
  return ExtendsResult.True;
}
function FromUnknown(left, right) {
  return type_exports.IsNever(right) ? FromNeverRight(left, right) : type_exports.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports.IsUnion(right) ? FromUnionRight(left, right) : type_exports.IsAny(right) ? FromAnyRight(left, right) : type_exports.IsString(right) ? FromStringRight(left, right) : type_exports.IsNumber(right) ? FromNumberRight(left, right) : type_exports.IsInteger(right) ? FromIntegerRight(left, right) : type_exports.IsBoolean(right) ? FromBooleanRight(left, right) : type_exports.IsArray(right) ? FromArrayRight(left, right) : type_exports.IsTuple(right) ? FromTupleRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsUnknown(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromVoidRight(left, right) {
  return type_exports.IsUndefined(left) ? ExtendsResult.True : type_exports.IsUndefined(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromVoid(left, right) {
  return type_exports.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports.IsUnion(right) ? FromUnionRight(left, right) : type_exports.IsUnknown(right) ? FromUnknownRight(left, right) : type_exports.IsAny(right) ? FromAnyRight(left, right) : type_exports.IsObject(right) ? FromObjectRight(left, right) : type_exports.IsVoid(right) ? ExtendsResult.True : ExtendsResult.False;
}
function Visit3(left, right) {
  return (
    // resolvable
    type_exports.IsTemplateLiteral(left) || type_exports.IsTemplateLiteral(right) ? FromTemplateLiteral2(left, right) : type_exports.IsRegExp(left) || type_exports.IsRegExp(right) ? FromRegExp(left, right) : type_exports.IsNot(left) || type_exports.IsNot(right) ? FromNot(left, right) : (
      // standard
      type_exports.IsAny(left) ? FromAny(left, right) : type_exports.IsArray(left) ? FromArray4(left, right) : type_exports.IsBigInt(left) ? FromBigInt(left, right) : type_exports.IsBoolean(left) ? FromBoolean(left, right) : type_exports.IsAsyncIterator(left) ? FromAsyncIterator(left, right) : type_exports.IsConstructor(left) ? FromConstructor(left, right) : type_exports.IsDate(left) ? FromDate(left, right) : type_exports.IsFunction(left) ? FromFunction(left, right) : type_exports.IsInteger(left) ? FromInteger(left, right) : type_exports.IsIntersect(left) ? FromIntersect4(left, right) : type_exports.IsIterator(left) ? FromIterator(left, right) : type_exports.IsLiteral(left) ? FromLiteral2(left, right) : type_exports.IsNever(left) ? FromNever(left, right) : type_exports.IsNull(left) ? FromNull(left, right) : type_exports.IsNumber(left) ? FromNumber(left, right) : type_exports.IsObject(left) ? FromObject(left, right) : type_exports.IsRecord(left) ? FromRecord(left, right) : type_exports.IsString(left) ? FromString(left, right) : type_exports.IsSymbol(left) ? FromSymbol(left, right) : type_exports.IsTuple(left) ? FromTuple3(left, right) : type_exports.IsPromise(left) ? FromPromise2(left, right) : type_exports.IsUint8Array(left) ? FromUint8Array(left, right) : type_exports.IsUndefined(left) ? FromUndefined(left, right) : type_exports.IsUnion(left) ? FromUnion6(left, right) : type_exports.IsUnknown(left) ? FromUnknown(left, right) : type_exports.IsVoid(left) ? FromVoid(left, right) : Throw(`Unknown left type operand '${left[Kind]}'`)
    )
  );
}
function ExtendsCheck(left, right) {
  return Visit3(left, right);
}

// node_modules/@sinclair/typebox/build/esm/type/extends/extends-from-mapped-result.mjs
function FromProperties8(P, Right, True, False, options) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Extends(P[K2], Right, True, False, Clone(options));
  return Acc;
}
function FromMappedResult6(Left, Right, True, False, options) {
  return FromProperties8(Left.properties, Right, True, False, options);
}
function ExtendsFromMappedResult(Left, Right, True, False, options) {
  const P = FromMappedResult6(Left, Right, True, False, options);
  return MappedResult(P);
}

// node_modules/@sinclair/typebox/build/esm/type/extends/extends.mjs
function ExtendsResolve(left, right, trueType, falseType) {
  const R = ExtendsCheck(left, right);
  return R === ExtendsResult.Union ? Union([trueType, falseType]) : R === ExtendsResult.True ? trueType : falseType;
}
function Extends(L, R, T, F, options) {
  return IsMappedResult(L) ? ExtendsFromMappedResult(L, R, T, F, options) : IsMappedKey(L) ? CreateType(ExtendsFromMappedKey(L, R, T, F, options)) : CreateType(ExtendsResolve(L, R, T, F), options);
}

// node_modules/@sinclair/typebox/build/esm/type/extends/extends-from-mapped-key.mjs
function FromPropertyKey(K, U, L, R, options) {
  return {
    [K]: Extends(Literal(K), U, L, R, Clone(options))
  };
}
function FromPropertyKeys(K, U, L, R, options) {
  return K.reduce((Acc, LK) => {
    return { ...Acc, ...FromPropertyKey(LK, U, L, R, options) };
  }, {});
}
function FromMappedKey2(K, U, L, R, options) {
  return FromPropertyKeys(K.keys, U, L, R, options);
}
function ExtendsFromMappedKey(T, U, L, R, options) {
  const P = FromMappedKey2(T, U, L, R, options);
  return MappedResult(P);
}

// node_modules/@sinclair/typebox/build/esm/type/exclude/exclude-from-template-literal.mjs
function ExcludeFromTemplateLiteral(L, R) {
  return Exclude(TemplateLiteralToUnion(L), R);
}

// node_modules/@sinclair/typebox/build/esm/type/exclude/exclude.mjs
function ExcludeRest(L, R) {
  const excluded = L.filter((inner) => ExtendsCheck(inner, R) === ExtendsResult.False);
  return excluded.length === 1 ? excluded[0] : Union(excluded);
}
function Exclude(L, R, options = {}) {
  if (IsTemplateLiteral(L))
    return CreateType(ExcludeFromTemplateLiteral(L, R), options);
  if (IsMappedResult(L))
    return CreateType(ExcludeFromMappedResult(L, R), options);
  return CreateType(IsUnion(L) ? ExcludeRest(L.anyOf, R) : ExtendsCheck(L, R) !== ExtendsResult.False ? Never() : L, options);
}

// node_modules/@sinclair/typebox/build/esm/type/exclude/exclude-from-mapped-result.mjs
function FromProperties9(P, U) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Exclude(P[K2], U);
  return Acc;
}
function FromMappedResult7(R, T) {
  return FromProperties9(R.properties, T);
}
function ExcludeFromMappedResult(R, T) {
  const P = FromMappedResult7(R, T);
  return MappedResult(P);
}

// node_modules/@sinclair/typebox/build/esm/type/extract/extract-from-template-literal.mjs
function ExtractFromTemplateLiteral(L, R) {
  return Extract(TemplateLiteralToUnion(L), R);
}

// node_modules/@sinclair/typebox/build/esm/type/extract/extract.mjs
function ExtractRest(L, R) {
  const extracted = L.filter((inner) => ExtendsCheck(inner, R) !== ExtendsResult.False);
  return extracted.length === 1 ? extracted[0] : Union(extracted);
}
function Extract(L, R, options) {
  if (IsTemplateLiteral(L))
    return CreateType(ExtractFromTemplateLiteral(L, R), options);
  if (IsMappedResult(L))
    return CreateType(ExtractFromMappedResult(L, R), options);
  return CreateType(IsUnion(L) ? ExtractRest(L.anyOf, R) : ExtendsCheck(L, R) !== ExtendsResult.False ? L : Never(), options);
}

// node_modules/@sinclair/typebox/build/esm/type/extract/extract-from-mapped-result.mjs
function FromProperties10(P, T) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Extract(P[K2], T);
  return Acc;
}
function FromMappedResult8(R, T) {
  return FromProperties10(R.properties, T);
}
function ExtractFromMappedResult(R, T) {
  const P = FromMappedResult8(R, T);
  return MappedResult(P);
}

// node_modules/@sinclair/typebox/build/esm/type/instance-type/instance-type.mjs
function InstanceType(schema, options) {
  return IsConstructor(schema) ? CreateType(schema.returns, options) : Never(options);
}

// node_modules/@sinclair/typebox/build/esm/type/readonly-optional/readonly-optional.mjs
function ReadonlyOptional(schema) {
  return Readonly(Optional(schema));
}

// node_modules/@sinclair/typebox/build/esm/type/record/record.mjs
function RecordCreateFromPattern(pattern, T, options) {
  return CreateType({ [Kind]: "Record", type: "object", patternProperties: { [pattern]: T } }, options);
}
function RecordCreateFromKeys(K, T, options) {
  const result = {};
  for (const K2 of K)
    result[K2] = T;
  return Object2(result, { ...options, [Hint]: "Record" });
}
function FromTemplateLiteralKey(K, T, options) {
  return IsTemplateLiteralFinite(K) ? RecordCreateFromKeys(IndexPropertyKeys(K), T, options) : RecordCreateFromPattern(K.pattern, T, options);
}
function FromUnionKey(key, type, options) {
  return RecordCreateFromKeys(IndexPropertyKeys(Union(key)), type, options);
}
function FromLiteralKey(key, type, options) {
  return RecordCreateFromKeys([key.toString()], type, options);
}
function FromRegExpKey(key, type, options) {
  return RecordCreateFromPattern(key.source, type, options);
}
function FromStringKey(key, type, options) {
  const pattern = IsUndefined(key.pattern) ? PatternStringExact : key.pattern;
  return RecordCreateFromPattern(pattern, type, options);
}
function FromAnyKey(_, type, options) {
  return RecordCreateFromPattern(PatternStringExact, type, options);
}
function FromNeverKey(_key, type, options) {
  return RecordCreateFromPattern(PatternNeverExact, type, options);
}
function FromBooleanKey(_key, type, options) {
  return Object2({ true: type, false: type }, options);
}
function FromIntegerKey(_key, type, options) {
  return RecordCreateFromPattern(PatternNumberExact, type, options);
}
function FromNumberKey(_, type, options) {
  return RecordCreateFromPattern(PatternNumberExact, type, options);
}
function Record(key, type, options = {}) {
  return IsUnion(key) ? FromUnionKey(key.anyOf, type, options) : IsTemplateLiteral(key) ? FromTemplateLiteralKey(key, type, options) : IsLiteral(key) ? FromLiteralKey(key.const, type, options) : IsBoolean2(key) ? FromBooleanKey(key, type, options) : IsInteger(key) ? FromIntegerKey(key, type, options) : IsNumber3(key) ? FromNumberKey(key, type, options) : IsRegExp2(key) ? FromRegExpKey(key, type, options) : IsString2(key) ? FromStringKey(key, type, options) : IsAny(key) ? FromAnyKey(key, type, options) : IsNever(key) ? FromNeverKey(key, type, options) : Never(options);
}
function RecordPattern(record) {
  return globalThis.Object.getOwnPropertyNames(record.patternProperties)[0];
}
function RecordKey2(type) {
  const pattern = RecordPattern(type);
  return pattern === PatternStringExact ? String2() : pattern === PatternNumberExact ? Number2() : String2({ pattern });
}
function RecordValue2(type) {
  return type.patternProperties[RecordPattern(type)];
}

// node_modules/@sinclair/typebox/build/esm/type/instantiate/instantiate.mjs
function FromConstructor2(args, type) {
  type.parameters = FromTypes(args, type.parameters);
  type.returns = FromType(args, type.returns);
  return type;
}
function FromFunction2(args, type) {
  type.parameters = FromTypes(args, type.parameters);
  type.returns = FromType(args, type.returns);
  return type;
}
function FromIntersect5(args, type) {
  type.allOf = FromTypes(args, type.allOf);
  return type;
}
function FromUnion7(args, type) {
  type.anyOf = FromTypes(args, type.anyOf);
  return type;
}
function FromTuple4(args, type) {
  if (IsUndefined(type.items))
    return type;
  type.items = FromTypes(args, type.items);
  return type;
}
function FromArray5(args, type) {
  type.items = FromType(args, type.items);
  return type;
}
function FromAsyncIterator2(args, type) {
  type.items = FromType(args, type.items);
  return type;
}
function FromIterator2(args, type) {
  type.items = FromType(args, type.items);
  return type;
}
function FromPromise3(args, type) {
  type.item = FromType(args, type.item);
  return type;
}
function FromObject2(args, type) {
  const mappedProperties = FromProperties11(args, type.properties);
  return { ...type, ...Object2(mappedProperties) };
}
function FromRecord2(args, type) {
  const mappedKey = FromType(args, RecordKey2(type));
  const mappedValue = FromType(args, RecordValue2(type));
  const result = Record(mappedKey, mappedValue);
  return { ...type, ...result };
}
function FromArgument(args, argument) {
  return argument.index in args ? args[argument.index] : Unknown();
}
function FromProperty2(args, type) {
  const isReadonly = IsReadonly(type);
  const isOptional = IsOptional(type);
  const mapped = FromType(args, type);
  return isReadonly && isOptional ? ReadonlyOptional(mapped) : isReadonly && !isOptional ? Readonly(mapped) : !isReadonly && isOptional ? Optional(mapped) : mapped;
}
function FromProperties11(args, properties) {
  return globalThis.Object.getOwnPropertyNames(properties).reduce((result, key) => {
    return { ...result, [key]: FromProperty2(args, properties[key]) };
  }, {});
}
function FromTypes(args, types) {
  return types.map((type) => FromType(args, type));
}
function FromType(args, type) {
  return IsConstructor(type) ? FromConstructor2(args, type) : IsFunction2(type) ? FromFunction2(args, type) : IsIntersect(type) ? FromIntersect5(args, type) : IsUnion(type) ? FromUnion7(args, type) : IsTuple(type) ? FromTuple4(args, type) : IsArray3(type) ? FromArray5(args, type) : IsAsyncIterator2(type) ? FromAsyncIterator2(args, type) : IsIterator2(type) ? FromIterator2(args, type) : IsPromise(type) ? FromPromise3(args, type) : IsObject3(type) ? FromObject2(args, type) : IsRecord(type) ? FromRecord2(args, type) : IsArgument(type) ? FromArgument(args, type) : type;
}
function Instantiate(type, args) {
  return FromType(args, CloneType(type));
}

// node_modules/@sinclair/typebox/build/esm/type/integer/integer.mjs
function Integer(options) {
  return CreateType({ [Kind]: "Integer", type: "integer" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/intrinsic/intrinsic-from-mapped-key.mjs
function MappedIntrinsicPropertyKey(K, M, options) {
  return {
    [K]: Intrinsic(Literal(K), M, Clone(options))
  };
}
function MappedIntrinsicPropertyKeys(K, M, options) {
  const result = K.reduce((Acc, L) => {
    return { ...Acc, ...MappedIntrinsicPropertyKey(L, M, options) };
  }, {});
  return result;
}
function MappedIntrinsicProperties(T, M, options) {
  return MappedIntrinsicPropertyKeys(T["keys"], M, options);
}
function IntrinsicFromMappedKey(T, M, options) {
  const P = MappedIntrinsicProperties(T, M, options);
  return MappedResult(P);
}

// node_modules/@sinclair/typebox/build/esm/type/intrinsic/intrinsic.mjs
function ApplyUncapitalize(value) {
  const [first, rest] = [value.slice(0, 1), value.slice(1)];
  return [first.toLowerCase(), rest].join("");
}
function ApplyCapitalize(value) {
  const [first, rest] = [value.slice(0, 1), value.slice(1)];
  return [first.toUpperCase(), rest].join("");
}
function ApplyUppercase(value) {
  return value.toUpperCase();
}
function ApplyLowercase(value) {
  return value.toLowerCase();
}
function FromTemplateLiteral3(schema, mode, options) {
  const expression = TemplateLiteralParseExact(schema.pattern);
  const finite = IsTemplateLiteralExpressionFinite(expression);
  if (!finite)
    return { ...schema, pattern: FromLiteralValue(schema.pattern, mode) };
  const strings = [...TemplateLiteralExpressionGenerate(expression)];
  const literals = strings.map((value) => Literal(value));
  const mapped = FromRest5(literals, mode);
  const union = Union(mapped);
  return TemplateLiteral([union], options);
}
function FromLiteralValue(value, mode) {
  return typeof value === "string" ? mode === "Uncapitalize" ? ApplyUncapitalize(value) : mode === "Capitalize" ? ApplyCapitalize(value) : mode === "Uppercase" ? ApplyUppercase(value) : mode === "Lowercase" ? ApplyLowercase(value) : value : value.toString();
}
function FromRest5(T, M) {
  return T.map((L) => Intrinsic(L, M));
}
function Intrinsic(schema, mode, options = {}) {
  return (
    // Intrinsic-Mapped-Inference
    IsMappedKey(schema) ? IntrinsicFromMappedKey(schema, mode, options) : (
      // Standard-Inference
      IsTemplateLiteral(schema) ? FromTemplateLiteral3(schema, mode, options) : IsUnion(schema) ? Union(FromRest5(schema.anyOf, mode), options) : IsLiteral(schema) ? Literal(FromLiteralValue(schema.const, mode), options) : (
        // Default Type
        CreateType(schema, options)
      )
    )
  );
}

// node_modules/@sinclair/typebox/build/esm/type/intrinsic/capitalize.mjs
function Capitalize(T, options = {}) {
  return Intrinsic(T, "Capitalize", options);
}

// node_modules/@sinclair/typebox/build/esm/type/intrinsic/lowercase.mjs
function Lowercase(T, options = {}) {
  return Intrinsic(T, "Lowercase", options);
}

// node_modules/@sinclair/typebox/build/esm/type/intrinsic/uncapitalize.mjs
function Uncapitalize(T, options = {}) {
  return Intrinsic(T, "Uncapitalize", options);
}

// node_modules/@sinclair/typebox/build/esm/type/intrinsic/uppercase.mjs
function Uppercase(T, options = {}) {
  return Intrinsic(T, "Uppercase", options);
}

// node_modules/@sinclair/typebox/build/esm/type/omit/omit-from-mapped-result.mjs
function FromProperties12(properties, propertyKeys, options) {
  const result = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(properties))
    result[K2] = Omit(properties[K2], propertyKeys, Clone(options));
  return result;
}
function FromMappedResult9(mappedResult, propertyKeys, options) {
  return FromProperties12(mappedResult.properties, propertyKeys, options);
}
function OmitFromMappedResult(mappedResult, propertyKeys, options) {
  const properties = FromMappedResult9(mappedResult, propertyKeys, options);
  return MappedResult(properties);
}

// node_modules/@sinclair/typebox/build/esm/type/omit/omit.mjs
function FromIntersect6(types, propertyKeys) {
  return types.map((type) => OmitResolve(type, propertyKeys));
}
function FromUnion8(types, propertyKeys) {
  return types.map((type) => OmitResolve(type, propertyKeys));
}
function FromProperty3(properties, key) {
  const { [key]: _, ...R } = properties;
  return R;
}
function FromProperties13(properties, propertyKeys) {
  return propertyKeys.reduce((T, K2) => FromProperty3(T, K2), properties);
}
function FromObject3(type, propertyKeys, properties) {
  const options = Discard(type, [TransformKind, "$id", "required", "properties"]);
  const mappedProperties = FromProperties13(properties, propertyKeys);
  return Object2(mappedProperties, options);
}
function UnionFromPropertyKeys(propertyKeys) {
  const result = propertyKeys.reduce((result2, key) => IsLiteralValue(key) ? [...result2, Literal(key)] : result2, []);
  return Union(result);
}
function OmitResolve(type, propertyKeys) {
  return IsIntersect(type) ? Intersect(FromIntersect6(type.allOf, propertyKeys)) : IsUnion(type) ? Union(FromUnion8(type.anyOf, propertyKeys)) : IsObject3(type) ? FromObject3(type, propertyKeys, type.properties) : Object2({});
}
function Omit(type, key, options) {
  const typeKey = IsArray(key) ? UnionFromPropertyKeys(key) : key;
  const propertyKeys = IsSchema(key) ? IndexPropertyKeys(key) : key;
  const isTypeRef = IsRef(type);
  const isKeyRef = IsRef(key);
  return IsMappedResult(type) ? OmitFromMappedResult(type, propertyKeys, options) : IsMappedKey(key) ? OmitFromMappedKey(type, key, options) : isTypeRef && isKeyRef ? Computed("Omit", [type, typeKey], options) : !isTypeRef && isKeyRef ? Computed("Omit", [type, typeKey], options) : isTypeRef && !isKeyRef ? Computed("Omit", [type, typeKey], options) : CreateType({ ...OmitResolve(type, propertyKeys), ...options });
}

// node_modules/@sinclair/typebox/build/esm/type/omit/omit-from-mapped-key.mjs
function FromPropertyKey2(type, key, options) {
  return { [key]: Omit(type, [key], Clone(options)) };
}
function FromPropertyKeys2(type, propertyKeys, options) {
  return propertyKeys.reduce((Acc, LK) => {
    return { ...Acc, ...FromPropertyKey2(type, LK, options) };
  }, {});
}
function FromMappedKey3(type, mappedKey, options) {
  return FromPropertyKeys2(type, mappedKey.keys, options);
}
function OmitFromMappedKey(type, mappedKey, options) {
  const properties = FromMappedKey3(type, mappedKey, options);
  return MappedResult(properties);
}

// node_modules/@sinclair/typebox/build/esm/type/pick/pick-from-mapped-result.mjs
function FromProperties14(properties, propertyKeys, options) {
  const result = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(properties))
    result[K2] = Pick(properties[K2], propertyKeys, Clone(options));
  return result;
}
function FromMappedResult10(mappedResult, propertyKeys, options) {
  return FromProperties14(mappedResult.properties, propertyKeys, options);
}
function PickFromMappedResult(mappedResult, propertyKeys, options) {
  const properties = FromMappedResult10(mappedResult, propertyKeys, options);
  return MappedResult(properties);
}

// node_modules/@sinclair/typebox/build/esm/type/pick/pick.mjs
function FromIntersect7(types, propertyKeys) {
  return types.map((type) => PickResolve(type, propertyKeys));
}
function FromUnion9(types, propertyKeys) {
  return types.map((type) => PickResolve(type, propertyKeys));
}
function FromProperties15(properties, propertyKeys) {
  const result = {};
  for (const K2 of propertyKeys)
    if (K2 in properties)
      result[K2] = properties[K2];
  return result;
}
function FromObject4(Type2, keys, properties) {
  const options = Discard(Type2, [TransformKind, "$id", "required", "properties"]);
  const mappedProperties = FromProperties15(properties, keys);
  return Object2(mappedProperties, options);
}
function UnionFromPropertyKeys2(propertyKeys) {
  const result = propertyKeys.reduce((result2, key) => IsLiteralValue(key) ? [...result2, Literal(key)] : result2, []);
  return Union(result);
}
function PickResolve(type, propertyKeys) {
  return IsIntersect(type) ? Intersect(FromIntersect7(type.allOf, propertyKeys)) : IsUnion(type) ? Union(FromUnion9(type.anyOf, propertyKeys)) : IsObject3(type) ? FromObject4(type, propertyKeys, type.properties) : Object2({});
}
function Pick(type, key, options) {
  const typeKey = IsArray(key) ? UnionFromPropertyKeys2(key) : key;
  const propertyKeys = IsSchema(key) ? IndexPropertyKeys(key) : key;
  const isTypeRef = IsRef(type);
  const isKeyRef = IsRef(key);
  return IsMappedResult(type) ? PickFromMappedResult(type, propertyKeys, options) : IsMappedKey(key) ? PickFromMappedKey(type, key, options) : isTypeRef && isKeyRef ? Computed("Pick", [type, typeKey], options) : !isTypeRef && isKeyRef ? Computed("Pick", [type, typeKey], options) : isTypeRef && !isKeyRef ? Computed("Pick", [type, typeKey], options) : CreateType({ ...PickResolve(type, propertyKeys), ...options });
}

// node_modules/@sinclair/typebox/build/esm/type/pick/pick-from-mapped-key.mjs
function FromPropertyKey3(type, key, options) {
  return {
    [key]: Pick(type, [key], Clone(options))
  };
}
function FromPropertyKeys3(type, propertyKeys, options) {
  return propertyKeys.reduce((result, leftKey) => {
    return { ...result, ...FromPropertyKey3(type, leftKey, options) };
  }, {});
}
function FromMappedKey4(type, mappedKey, options) {
  return FromPropertyKeys3(type, mappedKey.keys, options);
}
function PickFromMappedKey(type, mappedKey, options) {
  const properties = FromMappedKey4(type, mappedKey, options);
  return MappedResult(properties);
}

// node_modules/@sinclair/typebox/build/esm/type/partial/partial.mjs
function FromComputed3(target, parameters) {
  return Computed("Partial", [Computed(target, parameters)]);
}
function FromRef3($ref) {
  return Computed("Partial", [Ref($ref)]);
}
function FromProperties16(properties) {
  const partialProperties = {};
  for (const K of globalThis.Object.getOwnPropertyNames(properties))
    partialProperties[K] = Optional(properties[K]);
  return partialProperties;
}
function FromObject5(type, properties) {
  const options = Discard(type, [TransformKind, "$id", "required", "properties"]);
  const mappedProperties = FromProperties16(properties);
  return Object2(mappedProperties, options);
}
function FromRest6(types) {
  return types.map((type) => PartialResolve(type));
}
function PartialResolve(type) {
  return (
    // Mappable
    IsComputed(type) ? FromComputed3(type.target, type.parameters) : IsRef(type) ? FromRef3(type.$ref) : IsIntersect(type) ? Intersect(FromRest6(type.allOf)) : IsUnion(type) ? Union(FromRest6(type.anyOf)) : IsObject3(type) ? FromObject5(type, type.properties) : (
      // Intrinsic
      IsBigInt2(type) ? type : IsBoolean2(type) ? type : IsInteger(type) ? type : IsLiteral(type) ? type : IsNull2(type) ? type : IsNumber3(type) ? type : IsString2(type) ? type : IsSymbol2(type) ? type : IsUndefined3(type) ? type : (
        // Passthrough
        Object2({})
      )
    )
  );
}
function Partial(type, options) {
  if (IsMappedResult(type)) {
    return PartialFromMappedResult(type, options);
  } else {
    return CreateType({ ...PartialResolve(type), ...options });
  }
}

// node_modules/@sinclair/typebox/build/esm/type/partial/partial-from-mapped-result.mjs
function FromProperties17(K, options) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(K))
    Acc[K2] = Partial(K[K2], Clone(options));
  return Acc;
}
function FromMappedResult11(R, options) {
  return FromProperties17(R.properties, options);
}
function PartialFromMappedResult(R, options) {
  const P = FromMappedResult11(R, options);
  return MappedResult(P);
}

// node_modules/@sinclair/typebox/build/esm/type/required/required.mjs
function FromComputed4(target, parameters) {
  return Computed("Required", [Computed(target, parameters)]);
}
function FromRef4($ref) {
  return Computed("Required", [Ref($ref)]);
}
function FromProperties18(properties) {
  const requiredProperties = {};
  for (const K of globalThis.Object.getOwnPropertyNames(properties))
    requiredProperties[K] = Discard(properties[K], [OptionalKind]);
  return requiredProperties;
}
function FromObject6(type, properties) {
  const options = Discard(type, [TransformKind, "$id", "required", "properties"]);
  const mappedProperties = FromProperties18(properties);
  return Object2(mappedProperties, options);
}
function FromRest7(types) {
  return types.map((type) => RequiredResolve(type));
}
function RequiredResolve(type) {
  return (
    // Mappable
    IsComputed(type) ? FromComputed4(type.target, type.parameters) : IsRef(type) ? FromRef4(type.$ref) : IsIntersect(type) ? Intersect(FromRest7(type.allOf)) : IsUnion(type) ? Union(FromRest7(type.anyOf)) : IsObject3(type) ? FromObject6(type, type.properties) : (
      // Intrinsic
      IsBigInt2(type) ? type : IsBoolean2(type) ? type : IsInteger(type) ? type : IsLiteral(type) ? type : IsNull2(type) ? type : IsNumber3(type) ? type : IsString2(type) ? type : IsSymbol2(type) ? type : IsUndefined3(type) ? type : (
        // Passthrough
        Object2({})
      )
    )
  );
}
function Required(type, options) {
  if (IsMappedResult(type)) {
    return RequiredFromMappedResult(type, options);
  } else {
    return CreateType({ ...RequiredResolve(type), ...options });
  }
}

// node_modules/@sinclair/typebox/build/esm/type/required/required-from-mapped-result.mjs
function FromProperties19(P, options) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Required(P[K2], options);
  return Acc;
}
function FromMappedResult12(R, options) {
  return FromProperties19(R.properties, options);
}
function RequiredFromMappedResult(R, options) {
  const P = FromMappedResult12(R, options);
  return MappedResult(P);
}

// node_modules/@sinclair/typebox/build/esm/type/module/compute.mjs
function DereferenceParameters(moduleProperties, types) {
  return types.map((type) => {
    return IsRef(type) ? Dereference(moduleProperties, type.$ref) : FromType2(moduleProperties, type);
  });
}
function Dereference(moduleProperties, ref) {
  return ref in moduleProperties ? IsRef(moduleProperties[ref]) ? Dereference(moduleProperties, moduleProperties[ref].$ref) : FromType2(moduleProperties, moduleProperties[ref]) : Never();
}
function FromAwaited(parameters) {
  return Awaited(parameters[0]);
}
function FromIndex(parameters) {
  return Index(parameters[0], parameters[1]);
}
function FromKeyOf(parameters) {
  return KeyOf(parameters[0]);
}
function FromPartial(parameters) {
  return Partial(parameters[0]);
}
function FromOmit(parameters) {
  return Omit(parameters[0], parameters[1]);
}
function FromPick(parameters) {
  return Pick(parameters[0], parameters[1]);
}
function FromRequired(parameters) {
  return Required(parameters[0]);
}
function FromComputed5(moduleProperties, target, parameters) {
  const dereferenced = DereferenceParameters(moduleProperties, parameters);
  return target === "Awaited" ? FromAwaited(dereferenced) : target === "Index" ? FromIndex(dereferenced) : target === "KeyOf" ? FromKeyOf(dereferenced) : target === "Partial" ? FromPartial(dereferenced) : target === "Omit" ? FromOmit(dereferenced) : target === "Pick" ? FromPick(dereferenced) : target === "Required" ? FromRequired(dereferenced) : Never();
}
function FromArray6(moduleProperties, type) {
  return Array2(FromType2(moduleProperties, type));
}
function FromAsyncIterator3(moduleProperties, type) {
  return AsyncIterator(FromType2(moduleProperties, type));
}
function FromConstructor3(moduleProperties, parameters, instanceType) {
  return Constructor(FromTypes2(moduleProperties, parameters), FromType2(moduleProperties, instanceType));
}
function FromFunction3(moduleProperties, parameters, returnType) {
  return Function(FromTypes2(moduleProperties, parameters), FromType2(moduleProperties, returnType));
}
function FromIntersect8(moduleProperties, types) {
  return Intersect(FromTypes2(moduleProperties, types));
}
function FromIterator3(moduleProperties, type) {
  return Iterator(FromType2(moduleProperties, type));
}
function FromObject7(moduleProperties, properties) {
  return Object2(globalThis.Object.keys(properties).reduce((result, key) => {
    return { ...result, [key]: FromType2(moduleProperties, properties[key]) };
  }, {}));
}
function FromRecord3(moduleProperties, type) {
  const [value, pattern] = [FromType2(moduleProperties, RecordValue2(type)), RecordPattern(type)];
  const result = CloneType(type);
  result.patternProperties[pattern] = value;
  return result;
}
function FromTransform(moduleProperties, transform) {
  return IsRef(transform) ? { ...Dereference(moduleProperties, transform.$ref), [TransformKind]: transform[TransformKind] } : transform;
}
function FromTuple5(moduleProperties, types) {
  return Tuple(FromTypes2(moduleProperties, types));
}
function FromUnion10(moduleProperties, types) {
  return Union(FromTypes2(moduleProperties, types));
}
function FromTypes2(moduleProperties, types) {
  return types.map((type) => FromType2(moduleProperties, type));
}
function FromType2(moduleProperties, type) {
  return (
    // Modifiers
    IsOptional(type) ? CreateType(FromType2(moduleProperties, Discard(type, [OptionalKind])), type) : IsReadonly(type) ? CreateType(FromType2(moduleProperties, Discard(type, [ReadonlyKind])), type) : (
      // Transform
      IsTransform(type) ? CreateType(FromTransform(moduleProperties, type), type) : (
        // Types
        IsArray3(type) ? CreateType(FromArray6(moduleProperties, type.items), type) : IsAsyncIterator2(type) ? CreateType(FromAsyncIterator3(moduleProperties, type.items), type) : IsComputed(type) ? CreateType(FromComputed5(moduleProperties, type.target, type.parameters)) : IsConstructor(type) ? CreateType(FromConstructor3(moduleProperties, type.parameters, type.returns), type) : IsFunction2(type) ? CreateType(FromFunction3(moduleProperties, type.parameters, type.returns), type) : IsIntersect(type) ? CreateType(FromIntersect8(moduleProperties, type.allOf), type) : IsIterator2(type) ? CreateType(FromIterator3(moduleProperties, type.items), type) : IsObject3(type) ? CreateType(FromObject7(moduleProperties, type.properties), type) : IsRecord(type) ? CreateType(FromRecord3(moduleProperties, type)) : IsTuple(type) ? CreateType(FromTuple5(moduleProperties, type.items || []), type) : IsUnion(type) ? CreateType(FromUnion10(moduleProperties, type.anyOf), type) : type
      )
    )
  );
}
function ComputeType(moduleProperties, key) {
  return key in moduleProperties ? FromType2(moduleProperties, moduleProperties[key]) : Never();
}
function ComputeModuleProperties(moduleProperties) {
  return globalThis.Object.getOwnPropertyNames(moduleProperties).reduce((result, key) => {
    return { ...result, [key]: ComputeType(moduleProperties, key) };
  }, {});
}

// node_modules/@sinclair/typebox/build/esm/type/module/module.mjs
var TModule = class {
  constructor($defs) {
    const computed = ComputeModuleProperties($defs);
    const identified = this.WithIdentifiers(computed);
    this.$defs = identified;
  }
  /** `[Json]` Imports a Type by Key. */
  Import(key, options) {
    const $defs = { ...this.$defs, [key]: CreateType(this.$defs[key], options) };
    return CreateType({ [Kind]: "Import", $defs, $ref: key });
  }
  // prettier-ignore
  WithIdentifiers($defs) {
    return globalThis.Object.getOwnPropertyNames($defs).reduce((result, key) => {
      return { ...result, [key]: { ...$defs[key], $id: key } };
    }, {});
  }
};
function Module(properties) {
  return new TModule(properties);
}

// node_modules/@sinclair/typebox/build/esm/type/not/not.mjs
function Not(type, options) {
  return CreateType({ [Kind]: "Not", not: type }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/parameters/parameters.mjs
function Parameters(schema, options) {
  return IsFunction2(schema) ? Tuple(schema.parameters, options) : Never();
}

// node_modules/@sinclair/typebox/build/esm/type/recursive/recursive.mjs
var Ordinal = 0;
function Recursive(callback, options = {}) {
  if (IsUndefined(options.$id))
    options.$id = `T${Ordinal++}`;
  const thisType = CloneType(callback({ [Kind]: "This", $ref: `${options.$id}` }));
  thisType.$id = options.$id;
  return CreateType({ [Hint]: "Recursive", ...thisType }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/regexp/regexp.mjs
function RegExp2(unresolved, options) {
  const expr = IsString(unresolved) ? new globalThis.RegExp(unresolved) : unresolved;
  return CreateType({ [Kind]: "RegExp", type: "RegExp", source: expr.source, flags: expr.flags }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/rest/rest.mjs
function RestResolve(T) {
  return IsIntersect(T) ? T.allOf : IsUnion(T) ? T.anyOf : IsTuple(T) ? T.items ?? [] : [];
}
function Rest(T) {
  return RestResolve(T);
}

// node_modules/@sinclair/typebox/build/esm/type/return-type/return-type.mjs
function ReturnType(schema, options) {
  return IsFunction2(schema) ? CreateType(schema.returns, options) : Never(options);
}

// node_modules/@sinclair/typebox/build/esm/type/transform/transform.mjs
var TransformDecodeBuilder = class {
  constructor(schema) {
    this.schema = schema;
  }
  Decode(decode) {
    return new TransformEncodeBuilder(this.schema, decode);
  }
};
var TransformEncodeBuilder = class {
  constructor(schema, decode) {
    this.schema = schema;
    this.decode = decode;
  }
  EncodeTransform(encode, schema) {
    const Encode = (value) => schema[TransformKind].Encode(encode(value));
    const Decode = (value) => this.decode(schema[TransformKind].Decode(value));
    const Codec = { Encode, Decode };
    return { ...schema, [TransformKind]: Codec };
  }
  EncodeSchema(encode, schema) {
    const Codec = { Decode: this.decode, Encode: encode };
    return { ...schema, [TransformKind]: Codec };
  }
  Encode(encode) {
    return IsTransform(this.schema) ? this.EncodeTransform(encode, this.schema) : this.EncodeSchema(encode, this.schema);
  }
};
function Transform(schema) {
  return new TransformDecodeBuilder(schema);
}

// node_modules/@sinclair/typebox/build/esm/type/unsafe/unsafe.mjs
function Unsafe(options = {}) {
  return CreateType({ [Kind]: options[Kind] ?? "Unsafe" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/void/void.mjs
function Void(options) {
  return CreateType({ [Kind]: "Void", type: "void" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/type/type.mjs
var type_exports2 = {};
__export(type_exports2, {
  Any: () => Any,
  Argument: () => Argument,
  Array: () => Array2,
  AsyncIterator: () => AsyncIterator,
  Awaited: () => Awaited,
  BigInt: () => BigInt,
  Boolean: () => Boolean2,
  Capitalize: () => Capitalize,
  Composite: () => Composite,
  Const: () => Const,
  Constructor: () => Constructor,
  ConstructorParameters: () => ConstructorParameters,
  Date: () => Date2,
  Enum: () => Enum,
  Exclude: () => Exclude,
  Extends: () => Extends,
  Extract: () => Extract,
  Function: () => Function,
  Index: () => Index,
  InstanceType: () => InstanceType,
  Instantiate: () => Instantiate,
  Integer: () => Integer,
  Intersect: () => Intersect,
  Iterator: () => Iterator,
  KeyOf: () => KeyOf,
  Literal: () => Literal,
  Lowercase: () => Lowercase,
  Mapped: () => Mapped,
  Module: () => Module,
  Never: () => Never,
  Not: () => Not,
  Null: () => Null,
  Number: () => Number2,
  Object: () => Object2,
  Omit: () => Omit,
  Optional: () => Optional,
  Parameters: () => Parameters,
  Partial: () => Partial,
  Pick: () => Pick,
  Promise: () => Promise2,
  Readonly: () => Readonly,
  ReadonlyOptional: () => ReadonlyOptional,
  Record: () => Record,
  Recursive: () => Recursive,
  Ref: () => Ref,
  RegExp: () => RegExp2,
  Required: () => Required,
  Rest: () => Rest,
  ReturnType: () => ReturnType,
  String: () => String2,
  Symbol: () => Symbol2,
  TemplateLiteral: () => TemplateLiteral,
  Transform: () => Transform,
  Tuple: () => Tuple,
  Uint8Array: () => Uint8Array2,
  Uncapitalize: () => Uncapitalize,
  Undefined: () => Undefined,
  Union: () => Union,
  Unknown: () => Unknown,
  Unsafe: () => Unsafe,
  Uppercase: () => Uppercase,
  Void: () => Void
});

// node_modules/@sinclair/typebox/build/esm/type/type/index.mjs
var Type = type_exports2;

// index.ts
function generateSessionId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}
var CURRENT_SESSION_ID = generateSessionId();
var sessionMemoryIds = /* @__PURE__ */ new Set();
function parseSulcusToml(raw) {
  const result = {};
  let section = "";
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1).trim();
      continue;
    }
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const rawKey = line.slice(0, eqIdx).trim();
    const rawVal = line.slice(eqIdx + 1).trim();
    const fullKey = section ? `${section}.${rawKey}` : rawKey;
    const valNoComment = rawVal.replace(/\s*#.*$/, "");
    let parsed;
    if (valNoComment === "true") {
      parsed = true;
    } else if (valNoComment === "false") {
      parsed = false;
    } else if (valNoComment.startsWith("[") && valNoComment.endsWith("]")) {
      const inner = valNoComment.slice(1, -1);
      parsed = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else if (valNoComment.startsWith('"') && valNoComment.endsWith('"') || valNoComment.startsWith("'") && valNoComment.endsWith("'")) {
      parsed = valNoComment.slice(1, -1);
    } else {
      const num = Number(valNoComment);
      parsed = isNaN(num) ? valNoComment : num;
    }
    result[fullKey] = parsed;
  }
  return result;
}
function expandTomlKeys(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (typeof cur[part] !== "object" || cur[part] === null) {
        cur[part] = {};
      }
      cur = cur[part];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}
function loadSulcusToml(configPath, logger) {
  const defaultPath = (0, import_node_path.resolve)(process.env.HOME || "~", ".sulcus/sulcus.toml");
  const tomlPath = configPath ?? defaultPath;
  if (!(0, import_node_fs.existsSync)(tomlPath)) {
    return {};
  }
  try {
    const raw = (0, import_node_fs.readFileSync)(tomlPath, "utf8");
    const flat = parseSulcusToml(raw);
    const expanded = expandTomlKeys(flat);
    const keyCount = Object.keys(flat).length;
    logger?.info(`sulcus: loaded sulcus.toml (${keyCount} keys) from ${tomlPath}`);
    return expanded;
  } catch (err) {
    logger?.warn(`sulcus: failed to parse sulcus.toml at ${tomlPath}: ${err.message}`);
    return {};
  }
}
function mergeConfig(base, override) {
  const result = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val) && typeof result[key] === "object" && result[key] !== null && !Array.isArray(result[key])) {
      result[key] = mergeConfig(
        result[key],
        val
      );
    } else {
      result[key] = val;
    }
  }
  return result;
}
function buildStaticAwareness(backendMode, namespace) {
  return `<sulcus_context backend="${backendMode}" namespace="${namespace}">
You have Sulcus \u2014 persistent, thermodynamic memory. Memories survive across sessions with heat (0.0\u20131.0) that decays over time. Context is injected automatically each turn.
</sulcus_context>`;
}
var STATIC_AWARENESS = buildStaticAwareness("local", "default");
var FALLBACK_AWARENESS = `<sulcus_context token_budget="10000">
You have Sulcus \u2014 persistent memory. Context build failed this turn. Use memory_recall to search manually.
</sulcus_context>`;
var BUILTIN_PII_PATTERNS = [
  { name: "email", regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
  { name: "phone", regex: /(?:\+?\d[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4}\b/g },
  { name: "ssn", regex: /\b\d{3}[\s\-]\d{2}[\s\-]\d{4}\b/g },
  { name: "credit_card", regex: /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|6011\d{12}|3(?:0[0-5]|[68]\d)\d{11})\b/g },
  { name: "ip_address", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g }
];
var negPrefCache = null;
var NEG_PREF_CACHE_TTL_MS = 5 * 60 * 1e3;
var lastGuardFlags = null;
var inspectBuffer = {
  lastRecall: null,
  guardrailEvents: []
};
var INSPECT_GUARDRAIL_MAX = 10;
var guardrailStatus = null;
function pushGuardrailEvent(evt) {
  inspectBuffer.guardrailEvents.push(evt);
  if (inspectBuffer.guardrailEvents.length > INSPECT_GUARDRAIL_MAX) {
    inspectBuffer.guardrailEvents.shift();
  }
}
function scanForPii(content, activePatterns, customPatterns) {
  const spans = [];
  const patterns = BUILTIN_PII_PATTERNS.filter((p) => activePatterns.includes(p.name));
  for (const cp of customPatterns) {
    try {
      patterns.push({ name: cp.name, regex: new RegExp(cp.regex, "g") });
    } catch {
    }
  }
  for (const pat of patterns) {
    const re = new RegExp(pat.regex.source, "g");
    let m;
    while ((m = re.exec(content)) !== null) {
      const redactionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      spans.push({ start: m.index, end: m.index + m[0].length, type: pat.name, redactionId });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}
function redactSpans(content, spans) {
  let result = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) result += content.slice(cursor, span.start);
    result += `[REDACTED-${span.redactionId}]`;
    cursor = span.end;
  }
  result += content.slice(cursor);
  return result;
}
function storeRedactionKey(spans, content, storageKey, namespace) {
  try {
    const keyPath = storageKey.replace("~", process.env.HOME || "~");
    let store = {};
    if ((0, import_node_fs.existsSync)(keyPath)) {
      try {
        store = JSON.parse((0, import_node_fs.readFileSync)(keyPath, "utf-8"));
      } catch {
        store = {};
      }
    }
    if (!store.version) {
      store.version = 1;
      store.entries = {};
    }
    const entries = store.entries;
    for (const span of spans) {
      entries[span.redactionId] = {
        original: content.slice(span.start, span.end),
        type: span.type,
        redactedAt: (/* @__PURE__ */ new Date()).toISOString(),
        namespace
      };
    }
    const dir = keyPath.split("/").slice(0, -1).join("/");
    if (dir && !(0, import_node_fs.existsSync)(dir)) (0, import_node_fs.mkdirSync)(dir, { recursive: true });
    (0, import_node_fs.writeFileSync)(keyPath, JSON.stringify(store, null, 2), { mode: 384 });
  } catch {
  }
}
function parseOutputGuardConfig(pluginConfig) {
  const g = pluginConfig?.guardrails ?? {};
  const og = g?.outputGuard ?? {};
  const pii = og?.pii ?? {};
  const pv = og?.preferenceViolation ?? {};
  return {
    enabled: og?.enabled ?? false,
    pii: {
      enabled: pii?.enabled ?? false,
      reversible: pii?.reversible ?? true,
      storageKey: pii?.storageKey ?? "~/.openclaw/sulcus-redaction-key.json",
      patterns: pii?.patterns ?? ["email", "phone", "ssn", "credit_card", "ip_address"],
      customPatterns: pii?.customPatterns ?? [],
      onViolation: pii?.onViolation ?? "redact"
    },
    preferenceViolation: {
      enabled: pv?.enabled ?? true,
      onViolation: pv?.onViolation ?? "replace",
      replacementMessage: pv?.replacementMessage ?? "\u26A0\uFE0F I stopped myself \u2014 this output would violate a preference you've stored with me."
    },
    failMode: og?.failMode ?? "fail-open",
    auditTrail: og?.auditTrail ?? true
  };
}
function parseToolGuardConfig(pluginConfig) {
  const g = pluginConfig?.guardrails ?? {};
  const tg = g?.toolGuard ?? {};
  return {
    enabled: tg?.enabled ?? false,
    sensitiveTools: tg?.sensitiveTools ?? ["exec", "write", "edit", "delete", "message"],
    requireApprovalThreshold: tg?.requireApprovalThreshold ?? "warning",
    allowlist: tg?.allowlist ?? [],
    blocklist: tg?.blocklist ?? [],
    objectiveCheck: tg?.objectiveCheck ?? true,
    failMode: tg?.failMode ?? "fail-open",
    auditTrail: tg?.auditTrail ?? true
  };
}
var hookRecallCacheMap = /* @__PURE__ */ new Map();
var HOOK_CACHE_TTL_MS = 5 * 60 * 1e3;
var HOOK_TOPIC_SHIFT_THRESHOLD = 0.25;
var recallQM = {
  freshRecalls: 0,
  cacheHits: 0,
  totalItemsServed: 0,
  zeroResultTurns: 0,
  graphHopContrib: 0,
  graphHopTurns: 0,
  scoreSum: 0,
  scoreTurns: 0
};
var wasJustCompacted = false;
var REBUILD_TOKEN_BUDGET = 1e4;
var CORE_MEMORY_MAX_CHARS = 4e3;
var coreMemoryCache = void 0;
var activeNamespaceOverride = null;
function getEffectiveNamespace(configNamespace) {
  return activeNamespaceOverride ?? configNamespace;
}
var hookProfileStateMap = /* @__PURE__ */ new Map();
var hookHandlers = {
  inject_awareness: async (_event, _config, _ctx) => {
    return { appendSystemContext: STATIC_AWARENESS };
  },
  auto_recall: async (event, config, ctx) => {
    const { sulcusMem, namespace, logger } = ctx;
    if (!sulcusMem) return;
    const effectiveNamespace = getEffectiveNamespace(namespace);
    const agentLabel = event?.agentId ?? "(unknown)";
    logger.info(`sulcus: auto_recall hook triggered for agent ${agentLabel}`);
    const rawPrompt = typeof event?.prompt === "string" ? event.prompt : "";
    if (!rawPrompt) return;
    const prompt = sanitizeRecallQuery(rawPrompt);
    if (!prompt || prompt.length < 3) return;
    const recallQuery = extractLastUserTurn(rawPrompt);
    try {
      const limit = config.limit ?? 5;
      const profileFreq = ctx.profileFrequency ?? 10;
      let hookProfileState = hookProfileStateMap.get(effectiveNamespace);
      if (!hookProfileState) {
        hookProfileState = { turnCount: 0, cache: null };
        hookProfileStateMap.set(effectiveNamespace, hookProfileState);
      }
      hookProfileState.turnCount++;
      const hookTurn = hookProfileState.turnCount;
      const includeProfile = hookTurn === 1 || hookTurn % profileFreq === 0;
      const hookScale = applyAdaptiveScaling(hookTurn, limit, ctx.tokenBudget ?? 1e4);
      const hookContextWindow = ctx.contextWindowSize ?? 2e5;
      const hookThrottled = applyContextWindowThrottle(rawPrompt.length, hookContextWindow, hookScale, logger);
      if (hookThrottled.selfMuted) {
        logger.warn(`sulcus: hook path self-muted \u2014 context ${(rawPrompt.length / 4 / hookContextWindow * 100).toFixed(0)}% full`);
        return;
      }
      const hookEffectiveLimit = hookThrottled.effectiveMax;
      const hookEffectiveTokenBudget = hookThrottled.effectiveTokenBudget;
      if (hookTurn > 5) logger.debug?.(`sulcus: adaptive scaling (hook turn ${hookTurn}) \u2014 limit=${hookEffectiveLimit}, budget=${hookEffectiveTokenBudget}`);
      const cacheKey = effectiveNamespace;
      const currentTokens = extractTopicTokens(prompt);
      const existingCache = hookRecallCacheMap.get(cacheKey);
      const cacheExpired = existingCache !== void 0 && Date.now() - existingCache.cachedAt > HOOK_CACHE_TTL_MS;
      const overlap = existingCache !== void 0 ? topicOverlap(currentTokens, existingCache.topicTokens) : 0;
      const topicShifted = existingCache === void 0 || cacheExpired || overlap < HOOK_TOPIC_SHIFT_THRESHOLD;
      let vectorResults;
      if (!topicShifted && existingCache !== void 0) {
        vectorResults = existingCache.results;
        recallQM.cacheHits++;
        logger.info(`sulcus: auto_recall hook \u2014 topic stable (overlap=${overlap.toFixed(2)}), serving cached recall`);
      } else {
        if (existingCache !== void 0) {
          logger.info(`sulcus: auto_recall hook \u2014 TOPIC SHIFT detected (overlap=${overlap.toFixed(2)}), fresh recall`);
        }
        logger.debug?.(`sulcus: searching context for prompt (focused: ${recallQuery.substring(0, 50)}...) (namespace: ${effectiveNamespace})`);
        const res = await sulcusMem.search_memory(recallQuery, hookEffectiveLimit, effectiveNamespace);
        vectorResults = res?.results ?? [];
        recallQM.freshRecalls++;
        hookRecallCacheMap.set(cacheKey, { results: vectorResults, topicTokens: currentTokens, cachedAt: Date.now() });
      }
      if (!vectorResults || vectorResults.length === 0) {
        recallQM.zeroResultTurns++;
        return { prependSystemContext: FALLBACK_AWARENESS };
      }
      let hookExpanded = vectorResults;
      if (topicShifted && vectorResults.length < THIN_RECALL_THRESHOLD && sulcusMem instanceof SulcusCloudClient) {
        try {
          const { extraMemories, expandedQuery } = await expandQueryWithEntities(
            sulcusMem,
            recallQuery,
            effectiveNamespace,
            logger
          );
          const seenExpandIds = new Set(vectorResults.map((r) => r.id));
          const newExtras = extraMemories.filter((m) => !seenExpandIds.has(m.id));
          if (newExtras.length > 0) {
            hookExpanded = [...vectorResults, ...newExtras];
            logger.info(`sulcus: auto_recall thin-recall expansion added ${newExtras.length} entity-graph memory/memories`);
          }
          if (hookExpanded.length < THIN_RECALL_THRESHOLD && expandedQuery !== recallQuery) {
            try {
              const expandedRes = await sulcusMem.search_memory(expandedQuery, hookEffectiveLimit, effectiveNamespace);
              const expandedVec = expandedRes?.results ?? [];
              const expandedSeenIds = new Set(hookExpanded.map((r) => r.id));
              const newVecExtras = expandedVec.filter((r) => !expandedSeenIds.has(r.id));
              if (newVecExtras.length > 0) {
                hookExpanded = [...hookExpanded, ...newVecExtras];
                logger.info(`sulcus: auto_recall expanded query search added ${newVecExtras.length} result(s)`);
              }
            } catch {
            }
          }
        } catch {
        }
      }
      const vectorResults_expanded = hookExpanded;
      let rawResults = vectorResults_expanded;
      if (sulcusMem instanceof SulcusCloudClient) {
        const seedIds = vectorResults_expanded.slice(0, 2).map((r) => r.id).filter(Boolean);
        if (seedIds.length > 0) {
          try {
            const neighborFetches = await Promise.allSettled(
              seedIds.map((id) => sulcusMem.graph_neighbors(id, 6))
            );
            const seenIds = new Set(vectorResults_expanded.map((r) => r.id));
            const graphExtras = [];
            for (const result of neighborFetches) {
              if (result.status !== "fulfilled") continue;
              for (const node of result.value) {
                const nodeId = node.id;
                if (!nodeId || seenIds.has(nodeId)) continue;
                const heat = node.current_heat ?? 0;
                if (heat < 0.2) continue;
                seenIds.add(nodeId);
                graphExtras.push({ ...node, _source: "graph" });
              }
            }
            if (graphExtras.length > 0) {
              graphExtras.sort((a, b) => (b.current_heat ?? 0) - (a.current_heat ?? 0));
              const hopCount = Math.min(graphExtras.length, 4);
              rawResults = [...vectorResults_expanded, ...graphExtras.slice(0, hopCount)];
              recallQM.graphHopContrib += hopCount;
              recallQM.graphHopTurns++;
              logger.info(`sulcus: auto_recall graph-hop added ${hopCount} neighbour(s)`);
            }
          } catch {
          }
        }
      }
      const TOKEN_BUDGET = hookEffectiveTokenBudget;
      const FIXED_OVERHEAD = 80;
      let profilePreferences = [];
      let profileFacts = [];
      if (includeProfile) {
        try {
          const [prefRes, factRes] = await Promise.all([
            sulcusMem.search_memory("user preference", Math.min(hookEffectiveLimit, 5), effectiveNamespace),
            sulcusMem.search_memory("fact data knowledge", Math.min(hookEffectiveLimit, 5), effectiveNamespace)
          ]);
          profilePreferences = (prefRes?.results ?? []).filter((r) => r.memory_type === "preference");
          profileFacts = (factRes?.results ?? []).filter((r) => r.memory_type === "fact");
          hookProfileState.cache = { preferences: profilePreferences, facts: profileFacts, cachedAt: Date.now() };
          logger.info(`sulcus: auto_recall profile refreshed (turn ${hookTurn}, prefs=${profilePreferences.length}, facts=${profileFacts.length})`);
        } catch {
        }
      } else if (hookProfileState.cache) {
        profilePreferences = hookProfileState.cache.preferences;
        profileFacts = hookProfileState.cache.facts;
      }
      const profileIdSet = /* @__PURE__ */ new Set([
        ...profilePreferences.map((r) => r.id),
        ...profileFacts.map((r) => r.id)
      ]);
      const preDiversity = rawResults.filter((r) => !profileIdSet.has(r.id)).map((r) => ({
        ...r,
        label: r.label ?? r.pointer_summary ?? r.id ?? "",
        // Fix 2: prefer server fused_score over raw heat for ranking (Task 58)
        _heat: r.score ?? r.current_heat ?? 0
      }));
      preDiversity.sort((a, b) => b._heat - a._heat);
      const diverseResults = diversityFilter(preDiversity, hookEffectiveLimit);
      const droppedCount = preDiversity.length - diverseResults.length;
      if (droppedCount > 0) logger.info(`sulcus: auto_recall diversity filter dropped ${droppedCount} near-duplicate(s)`);
      const profileBudgetTokens = Math.floor((TOKEN_BUDGET - FIXED_OVERHEAD) * 0.3);
      const recallBudgetTokens = TOKEN_BUDGET - FIXED_OVERHEAD - profileBudgetTokens;
      const profileItemsSorted = [...profilePreferences, ...profileFacts].map((r) => ({
        ...r,
        label: (r.label ?? r.pointer_summary ?? r.id ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        _heat: r.score ?? r.current_heat ?? 0
      })).sort((a, b) => b._heat - a._heat);
      const budgetedProfile = enforceContextBudget(profileItemsSorted, TOKEN_BUDGET, FIXED_OVERHEAD + recallBudgetTokens);
      const escapedResults = diverseResults.map((r) => ({
        ...r,
        label: r.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      }));
      const hookSupersededCount = markSuperseded(escapedResults);
      if (hookSupersededCount > 0) logger.info(`sulcus: temporal supersession (hook) marked ${hookSupersededCount} memory/memories as superseded`);
      escapedResults.sort((a, b) => b._heat - a._heat);
      const budgeted = enforceContextBudget(escapedResults, TOKEN_BUDGET, FIXED_OVERHEAD + profileBudgetTokens);
      const hookTemporalDetected = isTemporalQuery(recallQuery);
      const orderedBudgeted = hookTemporalDetected ? temporalRerank(budgeted) : budgeted;
      if (hookTemporalDetected) logger.info(`sulcus: temporal query detected (hook) \u2014 re-ranking ${orderedBudgeted.length} results chronologically`);
      const recallElements = [];
      for (const r of orderedBudgeted) {
        const heat = r._heat;
        const heatStr = heat.toFixed(2);
        const mtype = r.memory_type ?? "episodic";
        const updatedAt = r.updated_at;
        const ageStr = updatedAt ? formatRelativeTime(updatedAt) : "unknown";
        const staleAttr = isStaleMemory(updatedAt) ? ` stale="true"` : "";
        const supersededAttr = r._superseded ? ` superseded="true"` : "";
        recallElements.push(`  <memory type="${mtype}" heat="${heatStr}" age="${ageStr}"${staleAttr}${supersededAttr}>${r.label}</memory>`);
      }
      let coreMemoryXml = "";
      if (sulcusMem instanceof SulcusCloudClient) {
        if (coreMemoryCache === void 0) {
          try {
            coreMemoryCache = await sulcusMem.get_core_memory();
            if (coreMemoryCache) {
              logger.info(`sulcus: core memory loaded (${JSON.stringify(coreMemoryCache).length} chars)`);
            }
          } catch {
            coreMemoryCache = null;
          }
        }
        if (coreMemoryCache && Object.keys(coreMemoryCache).length > 0) {
          const coreLines = [];
          for (const [key, value] of Object.entries(coreMemoryCache)) {
            if (key === "namespace" || key === "updated_at" || key === "created_at") continue;
            if (typeof value === "string" && value.trim()) {
              coreLines.push(`  <${key}>${escapeXml(value)}</${key}>`);
            } else if (Array.isArray(value) && value.length > 0) {
              const items = value.map((v) => `    <item>${escapeXml(String(v))}</item>`).join("\n");
              coreLines.push(`  <${key}>
${items}
  </${key}>`);
            } else if (typeof value === "object" && value !== null) {
              const entries = Object.entries(value).filter(([, v]) => v !== null && v !== void 0 && String(v).trim()).map(([k, v]) => `    <${k}>${escapeXml(String(v))}</${k}>`).join("\n");
              if (entries) coreLines.push(`  <${key}>
${entries}
  </${key}>`);
            }
          }
          if (coreLines.length > 0) {
            const raw = `<core_memory>
${coreLines.join("\n")}
</core_memory>`;
            coreMemoryXml = raw.length > CORE_MEMORY_MAX_CHARS ? raw.substring(0, CORE_MEMORY_MAX_CHARS) + "\n</core_memory>" : raw;
          }
        }
      }
      const sections = [];
      if (coreMemoryXml) sections.push(coreMemoryXml);
      if (budgetedProfile.length > 0) {
        const profileElements = [];
        for (const r of budgetedProfile) {
          const mtype = r.memory_type ?? "preference";
          const heat = r._heat.toFixed(2);
          profileElements.push(`  <item type="${mtype}" heat="${heat}">${r.label}</item>`);
        }
        sections.push(`<profile>
${profileElements.join("\n")}
</profile>`);
      }
      if (recallElements.length > 0) {
        const recallOrderAttr = hookTemporalDetected ? ` order="chronological"` : "";
        sections.push(`<recall${recallOrderAttr}>
${recallElements.join("\n")}
</recall>`);
      }
      if (sections.length === 0) return { prependSystemContext: FALLBACK_AWARENESS };
      const guidance = "Background context from long-term memory. Use it silently to inform your understanding \u2014 only reference it when the conversation naturally calls for it.";
      const contextParts = [
        `<guidance>${guidance}</guidance>`,
        ...sections
      ];
      const context = `<sulcus_context token_budget="${TOKEN_BUDGET}" namespace="${effectiveNamespace}" turn="${hookTurn}">
${contextParts.join("\n")}
</sulcus_context>`;
      const estimatedTokens = estimateTokens(context);
      recallQM.totalItemsServed += budgeted.length;
      if (budgeted.length === 0) recallQM.zeroResultTurns++;
      if (budgeted.length > 0 && topicShifted) {
        const hookAvgScore = budgeted.reduce((s, r) => s + (r._heat ?? 0), 0) / budgeted.length;
        recallQM.scoreSum += hookAvgScore;
        recallQM.scoreTurns++;
      }
      logger.info(`sulcus: auto_recall injecting context (${context.length} chars, ~${estimatedTokens}/${TOKEN_BUDGET} tokens, turn ${hookTurn}, profile: ${budgetedProfile.length}, recall: ${budgeted.length})`);
      {
        const staleHookItems = budgeted.filter((r) => r.stale === true || r._stale === true);
        const graphHookItems = budgeted.filter((r) => r._source === "graph");
        inspectBuffer.lastRecall = {
          capturedAt: Date.now(),
          path: "hook",
          turn: hookTurn,
          query: prompt.substring(0, 200),
          fromCache: !topicShifted,
          itemsInjected: budgetedProfile.length + budgeted.length,
          recallItems: budgeted.map((r) => ({
            id: r.id ?? "",
            content_preview: (r.content ?? r.text ?? "").substring(0, 80),
            memory_type: r.memory_type ?? r.type ?? "unknown",
            heat: r.current_heat ?? r._heat ?? 0,
            score: r.score ?? null,
            stale: !!(r.stale ?? r._stale),
            source: r._source === "graph" ? "graph" : "semantic"
          })),
          profileItems: budgetedProfile.length,
          staleCount: staleHookItems.length,
          graphHopCount: graphHookItems.length,
          tokensBudget: TOKEN_BUDGET,
          tokensUsed: estimatedTokens
        };
      }
      if (ctx.boostOnRecall !== false && sulcusMem instanceof SulcusCloudClient) {
        boostRecalledMemories(sulcusMem, budgeted, logger).catch(() => {
        });
      }
      if (topicShifted && sulcusMem instanceof SulcusCloudClient) {
        const recallIds = budgeted.map((r) => r.id ?? "").filter(Boolean);
        const recallScores = budgeted.map((r) => r._heat ?? 0);
        const recallSources = budgeted.map(
          (r) => r._source === "graph" ? "graph" : "semantic"
        );
        const entityHints = Array.from(currentTokens).slice(0, 10);
        const semanticCount = recallSources.filter((s) => s === "semantic").length;
        const graphCount = recallSources.filter((s) => s === "graph").length;
        sulcusMem.recall_log({
          namespace,
          agent_id: namespace,
          query_text: recallQuery.substring(0, 500),
          // Task 62: focused query
          memory_ids: recallIds,
          memory_scores: recallScores,
          memory_sources: recallSources,
          token_budget: TOKEN_BUDGET,
          tokens_used: estimatedTokens,
          candidates_total: rawResults.length,
          candidates_selected: recallIds.length,
          semantic_count: semanticCount,
          hot_count: graphCount,
          entity_count: entityHints.length,
          entity_hints: entityHints
        }).catch(() => {
        });
        logger.debug?.("sulcus: auto_recall SIRU log posted (hook path)");
      }
      return { prependSystemContext: context };
    } catch (e) {
      logger.warn(`sulcus: context build failed: ${e} \u2014 injecting fallback awareness`);
      return { prependSystemContext: FALLBACK_AWARENESS };
    }
  },
  none: async (event, _config, ctx) => {
    ctx.logger.debug?.(`sulcus: hook fired (action=none) for agent ${event.agentId ?? "(unknown)"} (no-op)`);
  },
  sivu_auto_capture: async (event, config, ctx) => {
    const { sulcusMem, logger } = ctx;
    if (!sulcusMem) return;
    const eventTrigger = event?.trigger ?? "";
    const skippedTriggers = ["exec-event", "cron-event", "heartbeat"];
    if (skippedTriggers.some((t) => eventTrigger === t)) {
      logger.debug?.(`sulcus: sivu_auto_capture \u2014 skipping trigger="${eventTrigger}"`);
      return;
    }
    const userMessage = event?.userMessage ?? event?.prompt ?? event?.text ?? "";
    if (!userMessage || typeof userMessage !== "string") {
      logger.debug?.("sulcus: sivu_auto_capture \u2014 no user message in event, skipping");
      return;
    }
    if (isJunkMemory(userMessage)) {
      logger.debug?.(`sulcus: sivu_auto_capture \u2014 pre-filtered junk: "${userMessage.substring(0, 50)}..."`);
      return;
    }
    if (!shouldCapture(userMessage)) {
      logger.debug?.("sulcus: sivu_auto_capture \u2014 dedup skip");
      return;
    }
    const minConfidence = config.min_store_confidence ?? 0.5;
    const fallbackOnError = config.fallback_on_error !== false;
    if (sulcusMem instanceof SulcusCloudClient) {
      try {
        const siuResult = await sulcusMem.request("POST", "/api/v2/siu/label", { text: userMessage });
        const storeConf = siuResult?.store_confidence ?? 0;
        const shouldStore = siuResult?.store === true && storeConf >= minConfidence;
        const memoryType = siuResult?.memory_type ?? "episodic";
        const modelVersion = siuResult?.model_version ?? "unknown";
        if (!shouldStore) {
          logger.info(`sulcus: sivu_auto_capture \u2014 SIVU rejected (confidence: ${storeConf.toFixed(3)}, model: ${modelVersion}): "${userMessage.substring(0, 60)}..."`);
          return;
        }
        const hints = buildExtractionHints(memoryType, ctx.namespace, "user_capture", userMessage.substring(0, 200));
        const res = await sulcusMem.add_memory(userMessage, memoryType, hints);
        const typeConf = (siuResult?.type_confidence ?? 0).toFixed(3);
        logger.info(`sulcus: sivu_auto_capture \u2014 stored [${memoryType}] (id: ${res?.id ?? "?"}, sivu_conf: ${storeConf.toFixed(3)}, sicu_conf: ${typeConf}, model: ${modelVersion}, hints: ${hints ? "yes" : "no"}): "${userMessage.substring(0, 60)}..."`);
        if (isCorrectionMessage(userMessage)) {
          const boosted = await boostRelatedMemories(sulcusMem, userMessage, ctx.namespace, 0.85, 3, logger);
          if (boosted > 0) {
            logger.info(`sulcus: sivu_auto_capture \u2014 correction detected, heat-boosted ${boosted} related memor${boosted === 1 ? "y" : "ies"}`);
          }
        }
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`sulcus: sivu_auto_capture \u2014 SIU v2 endpoint error: ${msg}`);
        if (!fallbackOnError) return;
      }
    }
    try {
      const fallbackHints = buildExtractionHints("episodic", ctx.namespace, "user_capture", userMessage.substring(0, 200));
      const res = await sulcusMem.add_memory(userMessage, "episodic", fallbackHints);
      logger.info(`sulcus: sivu_auto_capture \u2014 fallback stored [episodic] (id: ${res?.id ?? "?"}): "${userMessage.substring(0, 60)}..."`);
      if (isCorrectionMessage(userMessage) && sulcusMem instanceof SulcusCloudClient) {
        const boosted = await boostRelatedMemories(sulcusMem, userMessage, ctx.namespace, 0.85, 3, logger);
        if (boosted > 0) {
          logger.info(`sulcus: sivu_auto_capture \u2014 correction detected, heat-boosted ${boosted} related memor${boosted === 1 ? "y" : "ies"}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`sulcus: sivu_auto_capture \u2014 fallback store failed: ${msg}`);
    }
  },
  /**
   * auto_error_capture — stores tool errors as episodic memories with boosted heat.
   *
   * Fires on after_tool_call when a tool returns an error.
   * Stores the error context so the agent learns from past failures.
   * Skips errors from Sulcus's own tools to avoid self-referential loops.
   */
  auto_error_capture: async (event, _config, ctx) => {
    const { sulcusMem, logger } = ctx;
    const errorText = event?.error?.trim?.();
    if (!errorText || !sulcusMem) return;
    const toolName = event?.toolName ?? event?.tool_name ?? "unknown";
    if (typeof toolName === "string" && (toolName.startsWith("memory_") || toolName.startsWith("sulcus_") || toolName === "consolidate" || toolName === "evaluate_triggers" || toolName === "export_markdown" || toolName === "import_markdown" || toolName === "siu_label" || toolName === "siu_retrain")) {
      return;
    }
    const normalized = errorText.replace(/\s+/g, " ").trim();
    const truncated = normalized.length > 500 ? normalized.slice(0, 500) + " [truncated]" : normalized;
    const memoryContent = `Tool '${toolName}' failed: ${truncated}`;
    try {
      const errorHints = buildExtractionHints("episodic", ctx.namespace, "tool_error", memoryContent.substring(0, 200));
      const res = await sulcusMem.add_memory(memoryContent, "episodic", errorHints);
      if (res?.id && sulcusMem instanceof SulcusCloudClient) {
        await sulcusMem.request("PATCH", `/api/v1/agent/memory/${res.id}`, {
          current_heat: 0.8
        }).catch(() => {
        });
      }
      logger.info(`sulcus: auto_error_capture \u2014 stored tool error [episodic] (id: ${res?.id ?? "?"}): "${memoryContent.substring(0, 80)}..."`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.debug?.(`sulcus: auto_error_capture \u2014 failed to store: ${msg}`);
    }
  },
  pre_compaction_capture: async (event, _config, ctx) => {
    const { sulcusMem, logger } = ctx;
    if (!sulcusMem) return;
    const messages = Array.isArray(event?.messages) ? event.messages : [];
    if (messages.length === 0) return;
    wasJustCompacted = true;
    logger.info("sulcus: pre_compaction_capture \u2014 rebuild flag SET (next turn will inject full Sulcus context)");
    const firstUser = messages.find((m) => m.role === "user" || m.type === "human");
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" || m.type === "ai");
    const firstUserText = typeof firstUser?.content === "string" ? firstUser.content.substring(0, 200) : typeof firstUser?.text === "string" ? firstUser.text.substring(0, 200) : "(none)";
    const lastAssistantText = typeof lastAssistant?.content === "string" ? lastAssistant.content.substring(0, 200) : typeof lastAssistant?.text === "string" ? lastAssistant.text.substring(0, 200) : "(none)";
    const filesModified = [];
    const commandsRun = [];
    const decisions = [];
    const errors = [];
    const userIntents = [];
    const DECISION_MARKERS = ["decided", "will use", "going to", "plan is", "the fix", "conclusion", "recommend", "approach"];
    const ERROR_MARKERS = ["error:", "failed:", "exception", "traceback", "panicked", "stack trace"];
    for (const msg of messages) {
      const role = msg.role ?? msg.type;
      const rawContent = typeof msg.content === "string" ? msg.content : typeof msg.text === "string" ? msg.text : "";
      if ((role === "user" || role === "human") && rawContent.length > 10) {
        userIntents.push(rawContent.substring(0, 150));
      }
      if ((role === "assistant" || role === "ai") && rawContent.length > 20) {
        const lc = rawContent.toLowerCase();
        if (DECISION_MARKERS.some((m) => lc.includes(m))) {
          const sentences = rawContent.split(/[.!?\n]/).filter((s) => s.trim().length > 10);
          for (const s of sentences) {
            if (DECISION_MARKERS.some((m) => s.toLowerCase().includes(m)) && !decisions.includes(s.trim())) {
              decisions.push(s.trim().substring(0, 200));
              if (decisions.length >= 5) break;
            }
          }
        }
        const lcContent = rawContent.toLowerCase();
        if (ERROR_MARKERS.some((m) => lcContent.includes(m))) {
          const errorLine = rawContent.split("\n").find((l) => ERROR_MARKERS.some((m) => l.toLowerCase().includes(m)));
          if (errorLine && !errors.includes(errorLine.trim())) {
            errors.push(errorLine.trim().substring(0, 150));
          }
        }
      }
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (const tc of toolCalls) {
        const name = tc.name ?? tc.function;
        if (name === "Write" || name === "Edit" || name === "write" || name === "edit") {
          const input = tc.input ?? tc.arguments ?? {};
          const fp = input?.file_path ?? input?.path;
          if (fp && typeof fp === "string" && !filesModified.includes(fp)) filesModified.push(fp);
        }
        if (name === "Bash" || name === "bash" || name === "exec" || name === "shell") {
          const input = tc.input ?? tc.arguments ?? {};
          const cmd = input?.command ?? input?.cmd;
          if (cmd && typeof cmd === "string" && commandsRun.length < 5) {
            commandsRun.push(cmd.substring(0, 100));
          }
        }
      }
    }
    const episode = {
      topic: firstUserText,
      decisions: decisions.slice(0, 5),
      files_modified: filesModified.slice(0, 10),
      commands_run: commandsRun.slice(0, 5),
      errors: errors.slice(0, 3),
      outcome: "compacted",
      duration_turns: messages.length,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    const allText = messages.map((m) => {
      const content = typeof m.content === "string" ? m.content : typeof m.text === "string" ? m.text : "";
      return content.toLowerCase();
    }).join(" ");
    if (allText.includes("error") || allText.includes("failed") || allText.includes("broken")) {
      episode.mood = "debugging";
    } else if (allText.includes("looks good") || allText.includes("working") || allText.includes("done")) {
      episode.mood = "productive";
    } else if (allText.includes("?") && allText.split("?").length > 3) {
      episode.mood = "exploratory";
    } else {
      episode.mood = "neutral";
    }
    const summaryParts = [
      `Session compaction \u2014 ${messages.length} messages`,
      `First user message: ${firstUserText}`,
      `Last assistant message: ${lastAssistantText}`
    ];
    if (filesModified.length > 0) summaryParts.push(`Files modified: ${filesModified.join(", ")}`);
    if (commandsRun.length > 0) summaryParts.push(`Commands run: ${commandsRun.join(" | ")}`);
    const summary = summaryParts.join("\n");
    if (!shouldCapture(summary)) {
      logger.debug?.("sulcus: pre_compaction_capture \u2014 dedup skip");
      return;
    }
    const storePromises = [];
    const compactionHints = buildExtractionHints("episodic", ctx.namespace, "compaction", summary.substring(0, 200));
    storePromises.push(
      sulcusMem.add_memory(summary, "episodic", compactionHints).then(
        (res) => logger.info(`sulcus: pre_compaction_capture \u2014 stored session summary (id: ${res?.id ?? "?"})`)
      ).catch((e) => logger.debug?.(`sulcus: pre_compaction_capture \u2014 summary store failed: ${e instanceof Error ? e.message : String(e)}`))
    );
    if (decisions.length > 0) {
      const decisionText = `Session decisions: ${decisions.join(" | ")}`;
      const decisionHints = buildExtractionHints("semantic", ctx.namespace, "compaction", decisionText.substring(0, 200));
      storePromises.push(
        sulcusMem.add_memory(decisionText, "semantic", decisionHints).then(
          (res) => logger.info(`sulcus: pre_compaction_capture \u2014 stored decisions (id: ${res?.id ?? "?"})`)
        ).catch((e) => logger.debug?.(`sulcus: pre_compaction_capture \u2014 decisions store failed: ${e instanceof Error ? e.message : String(e)}`))
      );
    }
    if (userIntents.length > 2) {
      const midIntents = userIntents.slice(Math.floor(userIntents.length / 4), Math.floor(3 * userIntents.length / 4)).slice(0, 3);
      const intentsText = `Session user intents: ${midIntents.join(" | ")}`;
      if (shouldCapture(intentsText)) {
        const intentHints = buildExtractionHints("episodic", ctx.namespace, "compaction", intentsText.substring(0, 200));
        storePromises.push(
          sulcusMem.add_memory(intentsText, "episodic", intentHints).then(
            (res) => logger.info(`sulcus: pre_compaction_capture \u2014 stored intents (id: ${res?.id ?? "?"})`)
          ).catch((e) => logger.debug?.(`sulcus: pre_compaction_capture \u2014 intents store failed: ${e instanceof Error ? e.message : String(e)}`))
        );
      }
    }
    if (sulcusMem instanceof SulcusCloudClient) {
      storePromises.push(
        sulcusMem.store_episode(episode).then(
          (res) => logger.info(`sulcus: pre_compaction_capture \u2014 stored structured episode (id: ${res?.id ?? "?"})`)
        ).catch((e) => logger.debug?.(`sulcus: pre_compaction_capture \u2014 episode store failed: ${e instanceof Error ? e.message : String(e)}`))
      );
    }
    await Promise.allSettled(storePromises);
    logger.info(`sulcus: pre_compaction_capture \u2014 stored ${storePromises.length} memory/memories from ${messages.length}-message session`);
  }
};
function buildExtractionHints(memoryType, namespace, eventType, contentSnippet) {
  const hints = {};
  if (memoryType && memoryType !== "episodic") {
    hints.expected_type = memoryType;
  }
  const ns = namespace.toLowerCase();
  if (ns.includes("sulcus") || ns.includes("memory")) {
    hints.focus_areas = ["memory systems", "AI infrastructure", "sulcus"];
    hints.entity_types = ["tool", "concept", "project", "model"];
  } else if (ns.includes("daedalus") || ns.includes("forge") || ns.includes("workshop")) {
    hints.focus_areas = ["infrastructure", "devops", "software engineering", "AI agents"];
    hints.entity_types = ["tool", "project", "person", "organization"];
  } else if (ns.includes("icarus") || ns.includes("booker")) {
    hints.focus_areas = ["product development", "business logic"];
    hints.entity_types = ["tool", "project", "person"];
  }
  if (eventType === "tool_error") {
    hints.context_note = "This is a tool failure memory \u2014 focus on tool names, error patterns, and failure causes.";
    hints.entity_types = [...hints.entity_types ?? [], "tool"];
    hints.suppress_types = ["location"];
  } else if (eventType === "compaction") {
    hints.context_note = "This is a session summary from context compaction \u2014 extract key decisions, files modified, and tasks completed.";
    hints.entity_types = [...hints.entity_types ?? [], "project", "tool"];
  } else if (eventType === "user_capture") {
    if (!hints.context_note) {
      hints.context_note = "This was captured from a user message during an agent session.";
    }
  }
  const lower = contentSnippet.toLowerCase();
  if (lower.includes("prefer") || lower.includes("always") || lower.includes("never") || lower.includes("want")) {
    if (!hints.expected_type) hints.expected_type = "preference";
  } else if (lower.includes("step") || lower.includes("command") || lower.includes("run ") || lower.includes("deploy")) {
    if (!hints.expected_type) hints.expected_type = "procedural";
  } else if (lower.includes("is defined as") || lower.includes("means") || lower.includes("concept") || lower.includes("architecture")) {
    if (!hints.expected_type) hints.expected_type = "semantic";
  }
  const hasContent = (hints.entity_types?.length ?? 0) > 0 || (hints.focus_areas?.length ?? 0) > 0 || (hints.suppress_types?.length ?? 0) > 0 || hints.expected_type != null || hints.context_note != null;
  return hasContent ? hints : void 0;
}
var SulcusHttpError = class extends Error {
  constructor(message, statusCode, retryAfterMs) {
    super(message);
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
    this.name = "SulcusHttpError";
  }
  statusCode;
  retryAfterMs;
};
var SulcusCloudClient = class _SulcusCloudClient {
  serverUrl;
  apiKey;
  constructor(serverUrl, apiKey) {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }
  // -- Task 28: Transient retry with exponential backoff ---------------------
  // Retries on 502/503/504 and network errors — up to RETRY_MAX attempts.
  // Backoff: 400ms → 800ms → 1600ms (jitter ±20%). Non-retryable errors (4xx
  // except 429, 5xx ≠ 502/503/504) are surfaced immediately.
  static RETRY_MAX = 3;
  static RETRY_BASE_MS = 400;
  static RETRY_JITTER = 0.2;
  // ±20%
  _rawRequest(method, path, bodyStr, parsedUrl) {
    return new Promise((resolveP, rejectP) => {
      const isHttps = parsedUrl.protocol === "https:";
      const transport = isHttps ? https : http;
      const headers = {
        "Authorization": `Bearer ${this.apiKey}`,
        "Accept": "application/json"
      };
      if (bodyStr !== void 0) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
      }
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : isHttps ? 443 : 80,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers
      };
      const req = transport.request(options, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          if (!res.statusCode || res.statusCode >= 400) {
            let retryAfterMs;
            if (res.statusCode === 429) {
              const ra = res.headers["retry-after"];
              if (ra) {
                const raNum = Number(ra);
                retryAfterMs = isNaN(raNum) ? Math.max(0, new Date(ra).getTime() - Date.now()) : raNum * 1e3;
              }
            }
            return rejectP(new SulcusHttpError(
              `SulcusCloudClient: HTTP ${res.statusCode} for ${method} ${path}: ${raw.substring(0, 200)}`,
              res.statusCode,
              retryAfterMs
            ));
          }
          if (!raw || raw.trim() === "") return resolveP(null);
          try {
            resolveP(JSON.parse(raw));
          } catch (_e) {
            resolveP(raw);
          }
        });
      });
      req.on("error", (e) => rejectP(new SulcusHttpError(`SulcusCloudClient: network error for ${method} ${path}: ${e.message}`, 0)));
      if (bodyStr !== void 0) req.write(bodyStr);
      req.end();
    });
  }
  request(method, path, body) {
    let parsedUrl;
    try {
      parsedUrl = new import_node_url.URL(this.serverUrl + path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Promise.reject(new Error(`SulcusCloudClient: invalid URL ${this.serverUrl}${path}: ${msg}`));
    }
    const bodyStr = body !== void 0 ? JSON.stringify(body) : void 0;
    const isRetryable = (err) => {
      if (err.statusCode === 0) return true;
      if (err.statusCode === 429) return true;
      return err.statusCode === 502 || err.statusCode === 503 || err.statusCode === 504;
    };
    const attempt = (tries) => {
      return this._rawRequest(method, path, bodyStr, parsedUrl).catch((err) => {
        if (tries >= _SulcusCloudClient.RETRY_MAX || !isRetryable(err)) {
          throw err;
        }
        let delay;
        if (err.retryAfterMs !== void 0 && err.retryAfterMs > 0) {
          delay = err.retryAfterMs;
        } else {
          const base = _SulcusCloudClient.RETRY_BASE_MS * Math.pow(2, tries - 1);
          const jitter = base * _SulcusCloudClient.RETRY_JITTER * (Math.random() * 2 - 1);
          delay = Math.round(base + jitter);
        }
        return new Promise((res) => setTimeout(res, delay)).then(() => attempt(tries + 1));
      });
    };
    return attempt(1);
  }
  // -- end Task 28 --------------------------------------------------------------
  async search_memory(query, limit, namespace) {
    const body = { query };
    if (limit !== void 0) body.limit = limit;
    if (namespace !== void 0) body.namespace = namespace;
    const res = await this.request("POST", "/api/v1/agent/search", body);
    const results = res?.results ?? res?.items ?? res?.nodes ?? (Array.isArray(res) ? res : []);
    return { results };
  }
  async add_memory(content, memoryType, hints) {
    const body = { label: content };
    if (memoryType) body.memory_type = memoryType;
    if (hints) body.extraction_hints = hints;
    const res = await this.request("POST", "/api/v1/agent/nodes", body);
    return res ?? { id: "unknown" };
  }
  async list_hot_nodes(limit) {
    const q = limit ? `?limit=${limit}` : "";
    const res = await this.request("GET", `/api/v1/agent/hot_nodes${q}`);
    const nodes = Array.isArray(res) ? res : res?.hot_nodes ?? res?.nodes ?? [];
    return { nodes };
  }
  async consolidate(minHeat) {
    const body = {};
    if (minHeat !== void 0) body.min_heat = minHeat;
    return this.request("POST", "/api/v1/agent/consolidate", body);
  }
  async delete_memory(id, train) {
    const trainParam = train ? "true" : "false";
    return this.request("DELETE", `/api/v1/agent/nodes/${encodeURIComponent(id)}?train=${trainParam}`);
  }
  async export_markdown() {
    const res = await this.request("GET", "/api/v1/agent/export?format=markdown");
    if (typeof res === "string") return res;
    const r = res;
    return r?.content ?? r?.markdown ?? JSON.stringify(res, null, 2);
  }
  async import_markdown(text) {
    return this.request("POST", "/api/v1/agent/import", { format: "markdown", content: text });
  }
  async evaluate_triggers(event, contextJson) {
    const body = { event };
    if (contextJson) {
      try {
        body.context = JSON.parse(contextJson);
      } catch (_e) {
        body.context = contextJson;
      }
    }
    return this.request("POST", "/api/v1/triggers/evaluate", body);
  }
  async embed_text(text, namespace) {
    try {
      const body = { text };
      if (namespace) body.namespace = namespace;
      const res = await this.request("POST", "/api/v1/agent/embed", body);
      if (!res || !Array.isArray(res.embedding)) return null;
      return {
        embedding: res.embedding,
        model: res.model ?? "bge-small-en-v1.5",
        dimensions: res.dimensions ?? res.embedding.length
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404")) return null;
      throw e;
    }
  }
  async get_memory(id) {
    try {
      const res = await this.request("GET", `/api/v1/agent/nodes/${encodeURIComponent(id)}`);
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404")) return null;
      throw e;
    }
  }
  async list_memories(opts = {}) {
    const params = new URLSearchParams();
    if (opts.page !== void 0) params.set("page", String(opts.page));
    if (opts.page_size !== void 0) params.set("page_size", String(opts.page_size));
    if (opts.memory_type) params.set("memory_type", opts.memory_type);
    if (opts.namespace) params.set("namespace", opts.namespace);
    if (opts.pinned !== void 0) params.set("pinned", String(opts.pinned));
    if (opts.sort_by) params.set("sort_by", opts.sort_by);
    if (opts.sort_order) params.set("sort_order", opts.sort_order);
    const q = params.toString() ? `?${params.toString()}` : "";
    const res = await this.request("GET", `/api/v1/agent/nodes${q}`);
    if (Array.isArray(res)) return { items: res, total: res.length };
    const r = res ?? {};
    const items = r.items ?? r.nodes ?? r.results ?? [];
    return { items, total: r.total, page: r.page, page_size: r.page_size };
  }
  async update_memory(id, updates) {
    const res = await this.request("PATCH", `/api/v1/agent/memory/${encodeURIComponent(id)}`, updates);
    return res;
  }
  async probe() {
    try {
      await this.search_memory("probe", 1);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Fetch graph neighbours for a memory node via AGE Cypher.
   * Returns [] gracefully if the endpoint is unavailable (server too old).
   */
  async graph_neighbors(nodeId, limit = 6) {
    try {
      const res = await this.request("GET", `/api/v1/agent/graph/neighbors/${encodeURIComponent(nodeId)}?limit=${limit}`);
      if (!res) return [];
      const nodes = res.neighbors ?? res.nodes ?? res.results ?? (Array.isArray(res) ? res : []);
      return nodes;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404") || msg.includes("HTTP 404")) return [];
      return [];
    }
  }
  /**
   * Task 23: SIRU recall logging — post a recall session to the server for training data.
   * Fire-and-forget: called after each fresh recall, never blocks context injection.
   * Server stores this in recall_sessions table for SIRU adaptive scoring.
   */
  async recall_log(payload) {
    try {
      await this.request("POST", "/api/v1/agent/recall-log", payload);
    } catch {
    }
  }
  /**
   * Task 35: Entity-context lookup for query expansion.
   * Fetches graph-connected memories and sibling entities for a set of entity names.
   * Returns empty gracefully if the endpoint is unavailable.
   */
  async entity_context(entityNames, namespace, limit = 3) {
    try {
      const body = { entity_names: entityNames, limit };
      if (namespace) body.namespace = namespace;
      const res = await this.request("POST", "/api/v1/agent/entity-context", body);
      if (!res) return [];
      return res.entities ?? [];
    } catch {
      return [];
    }
  }
  /**
   * Task 34: Batch heat-boost — single round-trip to POST /api/v1/agent/boost-batch.
   * Accepts an array of { id, heat } boost items.
   * Returns true if the server accepted the batch; false if the endpoint is not yet deployed (404).
   * On false, the caller falls back to individual PATCH requests.
   */
  async boost_batch(boosts) {
    try {
      await this.request("POST", "/api/v1/agent/boost-batch", { boosts });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404")) return false;
      throw e;
    }
  }
  async graph_status() {
    return this.request("GET", "/api/v1/agent/graph/status");
  }
  async graph_temporal(query, timeFrom, timeTo, limit) {
    const body = { query };
    if (timeFrom) body.time_from = timeFrom;
    if (timeTo) body.time_to = timeTo;
    if (limit) body.limit = limit;
    const res = await this.request("POST", "/api/v1/agent/graph/temporal", body);
    return Array.isArray(res) ? res : [];
  }
  async list_conflicts(namespace, limit) {
    const params = new URLSearchParams();
    if (namespace) params.set("namespace", namespace);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    const res = await this.request("GET", `/api/v1/agent/conflicts${qs ? "?" + qs : ""}`);
    return Array.isArray(res) ? res : res?.conflicts ?? [];
  }
  async resolve_conflict(id, resolution) {
    return this.request("PATCH", `/api/v1/agent/conflicts/${encodeURIComponent(id)}`, { resolution });
  }
  async list_archived(namespace, limit, offset) {
    const params = new URLSearchParams();
    if (namespace) params.set("namespace", namespace);
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    const qs = params.toString();
    return this.request("GET", `/api/v1/agent/archive${qs ? "?" + qs : ""}`);
  }
  async restore_memories(ids, namespace) {
    return this.request("POST", "/api/v1/agent/restore", { ids, namespace });
  }
  async fold_memories(ids, namespace, label) {
    return this.request("POST", "/api/v1/agent/fold", { ids, label, namespace });
  }
  async dashboard_stats() {
    return this.request("GET", "/api/v1/admin/dashboard");
  }
  async storage_status() {
    return this.request("GET", "/api/v1/agent/storage");
  }
  async get_core_memory() {
    try {
      const params = new URLSearchParams();
      if (this.namespace) params.set("namespace", this.namespace);
      const qs = params.toString();
      return await this.request("GET", `/api/v1/agent/core-memory${qs ? "?" + qs : ""}`);
    } catch {
      return null;
    }
  }
  async update_core_memory(updates) {
    const body = { ...updates };
    if (this.namespace) body.namespace = this.namespace;
    return this.request("PATCH", "/api/v1/agent/core-memory", body);
  }
  // -- Phase 4: Episodic Session Layer ----------------------------------------
  async store_episode(episode) {
    const content = this.formatEpisodeSummary(episode);
    const hints = {
      memory_type: "episodic",
      context_note: "Structured session episode \u2014 contains topic, decisions, files, and outcome.",
      episode_metadata: episode
    };
    return this.request("POST", "/api/v1/agent/store", {
      content,
      memory_type: "episodic",
      namespace: this.namespace,
      hints,
      metadata: episode
    });
  }
  formatEpisodeSummary(episode) {
    const parts = [];
    if (episode.topic) parts.push(`Topic: ${episode.topic}`);
    if (Array.isArray(episode.decisions) && episode.decisions.length > 0) {
      parts.push(`Decisions: ${episode.decisions.join("; ")}`);
    }
    if (Array.isArray(episode.files_modified) && episode.files_modified.length > 0) {
      parts.push(`Files: ${episode.files_modified.join(", ")}`);
    }
    if (Array.isArray(episode.errors) && episode.errors.length > 0) {
      parts.push(`Errors: ${episode.errors.join("; ")}`);
    }
    if (episode.outcome) parts.push(`Outcome: ${episode.outcome}`);
    if (episode.mood) parts.push(`Mood: ${episode.mood}`);
    if (episode.duration_turns) parts.push(`Duration: ${episode.duration_turns} turns`);
    return `Session episode: ${parts.join(" | ")}`;
  }
  // -- Phase 6: Multi-user namespace listing ----------------------------------------
  async list_namespaces() {
    const res = await this.request("GET", "/api/v1/agent/namespaces");
    if (Array.isArray(res)) return res;
    const data = res;
    return data?.namespaces ?? data?.results ?? [];
  }
};
var NativeLibLoader = class {
  constructor(storeLibPath, vectorsLibPath) {
    this.storeLibPath = storeLibPath;
    this.vectorsLibPath = vectorsLibPath;
  }
  storeLibPath;
  vectorsLibPath;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  koffi = null;
  storeLib = null;
  vectorsLib = null;
  vectorsHandle = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn_store_init = null;
  fn_store_query = null;
  fn_store_free = null;
  fn_vectors_create = null;
  fn_vectors_text = null;
  fn_vectors_free = null;
  loaded = false;
  error = null;
  init(logger) {
    try {
      this.koffi = require("koffi");
    } catch (e) {
      this.error = `koffi not available: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }
    if (!(0, import_node_fs.existsSync)(this.storeLibPath)) {
      this.error = `libsulcus_store not found at ${this.storeLibPath}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }
    if (!(0, import_node_fs.existsSync)(this.vectorsLibPath)) {
      this.error = `libsulcus_vectors not found at ${this.vectorsLibPath}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }
    try {
      const k = this.koffi;
      this.storeLib = k.load(this.storeLibPath);
      this.fn_store_init = this.storeLib.func("sulcus_store_init", "int", ["str", "uint16"]);
      this.fn_store_query = this.storeLib.func("sulcus_store_query", "char*", ["str"]);
      this.fn_store_free = this.storeLib.func("sulcus_store_free_string", "void", ["char*"]);
    } catch (e) {
      this.error = `Failed to load libsulcus_store: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }
    try {
      const k = this.koffi;
      this.vectorsLib = k.load(this.vectorsLibPath);
      this.fn_vectors_create = this.vectorsLib.func("sulcus_vectors_create", "void*", []);
      this.fn_vectors_text = this.vectorsLib.func("sulcus_vectors_text", "char*", ["void*", "str"]);
      this.fn_vectors_free = this.vectorsLib.func("sulcus_vectors_free_string", "void", ["char*"]);
    } catch (e) {
      this.error = `Failed to load libsulcus_vectors: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }
    try {
      const dataDir = (0, import_node_path.resolve)(process.env.HOME || "~", ".sulcus/data");
      const rc = this.fn_store_init(dataDir, 15432);
      if (rc !== 0) {
        this.error = `sulcus_store_init returned ${rc}`;
        logger.warn(`sulcus: ${this.error}`);
        return;
      }
    } catch (e) {
      this.error = `sulcus_store_init failed: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }
    try {
      this.vectorsHandle = this.fn_vectors_create();
    } catch (e) {
      this.error = `sulcus_vectors_create failed: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }
    this.loaded = true;
    logger.info(`sulcus: native libs loaded (store: ${this.storeLibPath}, vectors: ${this.vectorsLibPath})`);
  }
  makeQueryFn() {
    return async (sql, params) => {
      if (!this.loaded) throw new Error("Sulcus store not available");
      const raw = this.fn_store_query(JSON.stringify({ sql, params }));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const p = parsed;
      return Array.isArray(parsed) ? parsed : Array.isArray(p?.rows) ? p.rows : [parsed];
    };
  }
  makeEmbedFn() {
    return async (text) => {
      if (!this.loaded) throw new Error("Sulcus vectors not available");
      const raw = this.fn_vectors_text(this.vectorsHandle, text);
      if (!raw) throw new Error("sulcus_vectors_text returned null");
      const arr = JSON.parse(raw);
      return new Float32Array(arr);
    };
  }
};
var JUNK_PATTERNS = [
  /^(HEARTBEAT_OK|NO_REPLY|NOOP)$/i,
  /^\s*$/,
  /^system:\s/i,
  /^(Gateway restart|Plugin .* updated|Discord inbound)/i,
  /^\[?(message_id|sender_id|conversation_label|schema)[\]":]/i,
  /^```json\s*\{?\s*"(message_id|sender_id|schema|chat_id)/i,
  /^Conversation info \(untrusted/i,
  /^Sender \(untrusted/i,
  /^UNTRUSTED (channel|Discord)/i,
  /^<<<EXTERNAL_UNTRUSTED_CONTENT/i,
  /^Runtime:/i,
  // Match raw function-call blobs only — NOT prose that mentions tool/function concepts.
  // e.g. raw JSON {"tool_calls":[...]} or <function_calls><invoke> XML sequences.
  // Avoids false-positives on architectural content like "the tool call returns..."
  /^\{"tool_calls":/i,
  /^<function_calls>\s*<invoke/i,
  /\[Inter-session message\]\s*sourceSession=/i,
  /<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>/,
  /<<<END_UNTRUSTED_CHILD_RESULT>>>/,
  /\[Internal task completion event\]/i,
  /^source:\s*subagent/im,
  /session_key:\s*agent:main:subagent:/i,
  /^Sulcus validation cycle\./i,
  /^Heartbeat prompt:/i,
  /OpenClaw runtime context \(internal\)/i,
  /\b(sk-[a-f0-9]{40,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,})\b/,
  /\b(api[_-]?key|secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}/i
];
function isJunkMemory(text) {
  if (!text || text.length < 10) return true;
  if (text.length > 1e4) return true;
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(text.trim())) return true;
  }
  return false;
}
var captureDedup = /* @__PURE__ */ new Map();
var DEDUP_WINDOW_MS = 5 * 60 * 1e3;
function shouldCapture(content) {
  const key = content.substring(0, 120) + "|" + content.length;
  const now = Date.now();
  for (const [k, ts] of captureDedup.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) captureDedup.delete(k);
  }
  if (captureDedup.has(key)) return false;
  captureDedup.set(key, now);
  return true;
}
function loadHooksConfig(apiConfig) {
  const defaultsPath = (0, import_node_path.resolve)(__dirname, "hooks.defaults.json");
  let defaults;
  try {
    defaults = JSON.parse(require("fs").readFileSync(defaultsPath, "utf-8"));
  } catch (_e) {
    defaults = {
      version: 1,
      hooks: {
        before_prompt_build: { action: "inject_awareness", enabled: true },
        before_agent_start: { action: "auto_recall", enabled: false, limit: 5, minScore: 0.3 },
        agent_end: { action: "none", enabled: true },
        after_tool_call: { action: "auto_error_capture", enabled: true },
        before_compaction: { action: "pre_compaction_capture", enabled: true }
      },
      tools: {
        memory_recall: { enabled: true },
        memory_store: { enabled: true },
        memory_status: { enabled: true },
        memory_profile: { enabled: true },
        consolidate: { enabled: false },
        export_markdown: { enabled: false },
        import_markdown: { enabled: false },
        evaluate_triggers: { enabled: false },
        memory_inspect: { enabled: true },
        guardrail_status: { enabled: true },
        __sulcus_workflow__: { enabled: true },
        session_store: { enabled: true },
        session_recall: { enabled: true },
        memory_get: { enabled: true },
        memory_list: { enabled: true },
        memory_update: { enabled: true },
        siu_label: { enabled: false },
        siu_status: { enabled: false },
        siu_retrain: { enabled: false },
        trigger_feedback: { enabled: false },
        graph_explore: { enabled: true },
        memory_conflicts: { enabled: true },
        core_memory_read: { enabled: true },
        core_memory_update: { enabled: true },
        memory_archive: { enabled: true },
        memory_fold: { enabled: true },
        memory_dashboard: { enabled: true },
        episode_recall: { enabled: true },
        memory_namespace: { enabled: true },
        namespace_list: { enabled: true },
        sulcus_setup: { enabled: true }
      }
    };
  }
  const userHooks = apiConfig?.hooks ?? {};
  const userTools = apiConfig?.tools ?? {};
  const mergedHooks = { ...defaults.hooks };
  for (const [name, override] of Object.entries(userHooks)) {
    mergedHooks[name] = { ...mergedHooks[name] ?? { action: "none", enabled: false }, ...override };
  }
  const mergedTools = { ...defaults.tools };
  for (const [name, override] of Object.entries(userTools)) {
    mergedTools[name] = { ...mergedTools[name] ?? { enabled: false }, ...override };
  }
  if (apiConfig?.autoRecall === true) {
    mergedHooks["before_prompt_build"] = {
      ...mergedHooks["before_prompt_build"] ?? { action: "auto_recall", enabled: false },
      enabled: true
    };
    mergedHooks["before_agent_start"] = {
      ...mergedHooks["before_agent_start"] ?? { action: "auto_recall", enabled: false },
      enabled: true
    };
  }
  return { version: defaults.version, hooks: mergedHooks, tools: mergedTools };
}
function formatRelativeTime(isoTimestamp) {
  try {
    const dt = new Date(isoTimestamp);
    const now = /* @__PURE__ */ new Date();
    const seconds = (now.getTime() - dt.getTime()) / 1e3;
    const minutes = seconds / 60;
    const hours = seconds / 3600;
    const days = seconds / 86400;
    if (minutes < 2) return "just now";
    if (minutes < 60) return `${Math.floor(minutes)}m ago`;
    if (hours < 24) return `${Math.floor(hours)}h ago`;
    if (days < 7) return `${Math.floor(days)}d ago`;
    const month = dt.toLocaleString("en", { month: "short" });
    if (dt.getFullYear() === now.getFullYear()) return `${dt.getDate()} ${month}`;
    return `${dt.getDate()} ${month}, ${dt.getFullYear()}`;
  } catch {
    return "";
  }
}
var STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1e3;
function isStaleMemory(isoTimestamp) {
  if (!isoTimestamp) return false;
  try {
    const dt = new Date(isoTimestamp);
    return Date.now() - dt.getTime() > STALE_THRESHOLD_MS;
  } catch {
    return false;
  }
}
var CORRECTION_MARKERS = [
  "actually,",
  "actually ",
  "that's wrong",
  "thats wrong",
  "that is wrong",
  "correction:",
  "no, it",
  "no it's",
  "not quite",
  "update:",
  "i meant",
  "i mean",
  "i was wrong",
  "was incorrect",
  "is incorrect",
  "please update",
  "forget that",
  "ignore that",
  "disregard",
  "instead,",
  "rather,",
  "not that,",
  "fix:"
];
function isCorrectionMessage(text) {
  const lower = text.toLowerCase();
  return CORRECTION_MARKERS.some((m) => lower.includes(m));
}
var GENERIC_ACK_PATTERNS = [
  /^(ok|okay|sure|got it|will do|understood|noted|done|sounds good|great|perfect|no problem|no worries|absolutely|certainly|of course|copy that|roger|on it|right away|working on it|let me|i'll|i will)[\.!,]?$/i,
  /^(yes|yeah|yep|yup|nope|no|nah)[\.!]?$/i,
  /^(thanks|thank you|thx|ty)[\.!]?$/i,
  /^(one moment|just a moment|give me a (second|moment|sec))[\.!,]?$/i,
  /^(looking into|checking|fetching|retrieving|processing|analyzing)\b/i
];
function isGenericAck(text) {
  const trimmed = text.trim();
  if (trimmed.length > 250) return false;
  return GENERIC_ACK_PATTERNS.some((p) => p.test(trimmed));
}
var ASSISTANT_CAPTURE_MAX_DIRECT = 1500;
function summarizeForCapture(text, namespace) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 20);
  if (paragraphs.length === 0) return text.substring(0, ASSISTANT_CAPTURE_MAX_DIRECT);
  const DECISION_MARKERS = [
    "decided",
    "recommend",
    "conclusion",
    "therefore",
    "result:",
    "outcome:",
    "solution:",
    "answer:",
    "key point",
    "important:",
    "note:",
    "summary:",
    "in summary",
    "to summarize",
    "bottom line",
    "takeaway"
  ];
  const keyParagraphs = [];
  if (paragraphs[0]) keyParagraphs.push(paragraphs[0]);
  for (let i = 1; i < paragraphs.length - 1; i++) {
    const pLower = paragraphs[i].toLowerCase();
    if (DECISION_MARKERS.some((m) => pLower.includes(m))) {
      keyParagraphs.push(paragraphs[i]);
      if (keyParagraphs.length >= 3) break;
    }
  }
  const last = paragraphs[paragraphs.length - 1];
  if (last && last !== keyParagraphs[0]) keyParagraphs.push(last);
  const summary = keyParagraphs.join(" [...] ").substring(0, ASSISTANT_CAPTURE_MAX_DIRECT);
  return `[assistant summary, ns=${namespace}] ${summary}`;
}
async function boostRelatedMemories(sulcusMem, query, namespace, boostHeat, limit, logger) {
  let boosted = 0;
  try {
    const res = await sulcusMem.search_memory(query, limit, namespace);
    const results = res?.results ?? [];
    await Promise.allSettled(
      results.map(async (node) => {
        const nodeId = node.id;
        if (!nodeId) return;
        try {
          await sulcusMem.request("PATCH", `/api/v1/agent/memory/${nodeId}`, { current_heat: boostHeat });
          boosted++;
        } catch {
        }
      })
    );
  } catch {
  }
  return boosted;
}
async function boostRecalledMemories(sulcusMem, memories, logger) {
  const BOOST_CAP = 0.95;
  const MIN_HEAT_FOR_BOOST = 0.1;
  const SKIP_ABOVE = 0.85;
  function boostDelta(heat) {
    if (heat < MIN_HEAT_FOR_BOOST || heat >= SKIP_ABOVE) return 0;
    if (heat < 0.4) return 0.12;
    if (heat < 0.65) return 0.08;
    return 0.05;
  }
  const toBoost = memories.map((m) => ({ id: m.id, heat: m.current_heat ?? 0 })).filter((m) => m.id && boostDelta(m.heat) > 0);
  if (toBoost.length === 0) return;
  const batchItems = toBoost.map(({ id, heat }) => ({
    id,
    heat: parseFloat(Math.min(BOOST_CAP, heat + boostDelta(heat)).toFixed(3))
  }));
  let usedBatch = false;
  try {
    usedBatch = await sulcusMem.boost_batch(batchItems);
  } catch {
  }
  if (usedBatch) {
    const totalDeltaBatch = toBoost.reduce((acc, { heat }) => acc + boostDelta(heat), 0);
    const avgDelta = (totalDeltaBatch / toBoost.length).toFixed(3);
    logger.info(`sulcus: boost-on-recall \u2014 batch boost for ${toBoost.length} memor${toBoost.length === 1 ? "y" : "ies"} (avg \u0394${avgDelta}, 1 round-trip)`);
    return;
  }
  let boosted = 0;
  let totalDelta = 0;
  await Promise.allSettled(
    toBoost.map(async ({ id, heat }) => {
      const delta = boostDelta(heat);
      const newHeat = Math.min(BOOST_CAP, heat + delta);
      try {
        await sulcusMem.request("PATCH", `/api/v1/agent/memory/${encodeURIComponent(id)}`, {
          current_heat: parseFloat(newHeat.toFixed(3))
        });
        boosted++;
        totalDelta += delta;
      } catch {
      }
    })
  );
  if (boosted > 0) {
    const avgDelta = (totalDelta / boosted).toFixed(3);
    logger.info(`sulcus: boost-on-recall \u2014 individual boost for ${boosted}/${toBoost.length} memor${boosted === 1 ? "y" : "ies"} (avg \u0394${avgDelta}, ${toBoost.length} round-trips)`);
  }
}
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function truncateLabel(label, maxChars) {
  if (label.length <= maxChars) return label;
  const cut = label.lastIndexOf(" ", maxChars - 3);
  const boundary = cut > maxChars * 0.6 ? cut : maxChars - 3;
  return label.slice(0, boundary) + "\u2026";
}
function applyAdaptiveScaling(turnCount, maxResults, tokenBudget) {
  let factor = 1;
  if (turnCount > 30) factor = 0.4;
  else if (turnCount > 15) factor = 0.6;
  else if (turnCount > 5) factor = 0.8;
  return {
    effectiveMax: Math.max(2, Math.floor(maxResults * factor)),
    effectiveTokenBudget: Math.max(500, Math.floor(tokenBudget * factor)),
    selfMuted: false
  };
}
function applyContextWindowThrottle(promptChars, contextWindowTokens, scale, logger) {
  const estimatedTokens = Math.ceil(promptChars / 4);
  const utilization = estimatedTokens / contextWindowTokens;
  if (utilization > 0.93) {
    logger?.warn?.(`sulcus: context window ${(utilization * 100).toFixed(0)}% full (~${estimatedTokens} tokens / ${contextWindowTokens}) \u2014 SELF-MUTING recall injection`);
    return { effectiveMax: 0, effectiveTokenBudget: 0, selfMuted: true };
  }
  if (utilization > 0.85) {
    logger?.info?.(`sulcus: context window ${(utilization * 100).toFixed(0)}% full \u2014 aggressive throttle (20% budget, max 2 results)`);
    return {
      effectiveMax: Math.min(2, scale.effectiveMax),
      effectiveTokenBudget: Math.max(200, Math.floor(scale.effectiveTokenBudget * 0.2)),
      selfMuted: false
    };
  }
  if (utilization > 0.7) {
    logger?.debug?.(`sulcus: context window ${(utilization * 100).toFixed(0)}% full \u2014 moderate throttle (50% budget)`);
    return {
      effectiveMax: Math.max(2, Math.floor(scale.effectiveMax * 0.6)),
      effectiveTokenBudget: Math.max(300, Math.floor(scale.effectiveTokenBudget * 0.5)),
      selfMuted: false
    };
  }
  return scale;
}
function enforceContextBudget(items, tokenBudget, overhead) {
  const remaining = tokenBudget - overhead;
  if (remaining <= 0) return [];
  const MAX_LABEL_CHARS = 250;
  const perItemCharCap = Math.min(MAX_LABEL_CHARS, Math.floor(remaining * 4 * 0.4));
  const result = [];
  let usedTokens = 0;
  for (const item of items) {
    const truncated = truncateLabel(item.label, perItemCharCap);
    const itemTokens = estimateTokens(truncated) + 8;
    if (usedTokens + itemTokens > remaining) break;
    result.push({ ...item, label: truncated });
    usedTokens += itemTokens;
  }
  return result;
}
var DIVERSITY_LAMBDA = 0.55;
var DIVERSITY_SIM_THRESHOLD = 0.65;
function diversityFilter(items, limit) {
  if (items.length <= 1) return items;
  const selected = [];
  const remaining = [...items];
  const first = remaining.splice(0, 1)[0];
  selected.push(first);
  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      let maxSim = 0;
      for (const sel of selected) {
        const sim = topicTokenOverlap(candidate.label, sel.label);
        if (sim > maxSim) maxSim = sim;
      }
      const score = candidate._heat * (1 - DIVERSITY_LAMBDA * maxSim);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    const maxSimToSelected = selected.reduce((m, s) => {
      const sim = topicTokenOverlap(chosen.label, s.label);
      return sim > m ? sim : m;
    }, 0);
    if (maxSimToSelected < DIVERSITY_SIM_THRESHOLD) {
      selected.push(chosen);
    }
  }
  return selected;
}
var NEGATION_MARKERS = [
  "not ",
  "no longer",
  "never",
  "removed",
  "deprecated",
  "disabled",
  "changed",
  "replaced",
  "fixed",
  "incorrect",
  "wrong",
  "actually",
  "correction",
  "mistake",
  "was wrong",
  "instead",
  "update:"
];
function hasNegationMarker(text) {
  const lower = text.toLowerCase();
  return NEGATION_MARKERS.some((m) => lower.includes(m));
}
function topicTokenOverlap(a, b) {
  const ta = extractTopicTokens(a);
  const tb = extractTopicTokens(b);
  return topicOverlap(ta, tb);
}
function parseISOMs(iso) {
  if (!iso) return 0;
  try {
    return new Date(iso).getTime();
  } catch {
    return 0;
  }
}
var TEMPORAL_KEYWORDS = [
  "yesterday",
  "today",
  "last week",
  "this week",
  "last month",
  "this month",
  "days ago",
  "hours ago",
  "weeks ago",
  "months ago",
  "last monday",
  "last tuesday",
  "last wednesday",
  "last thursday",
  "last friday",
  "last saturday",
  "last sunday",
  "recently",
  "timeline",
  "chronolog",
  "sequence of",
  "in order",
  "what order",
  "time order",
  "when did",
  "when was",
  "since when",
  "how long ago",
  "first thing",
  "before that",
  "after that"
];
function isTemporalQuery(query) {
  const q = query.toLowerCase();
  return TEMPORAL_KEYWORDS.some((kw) => q.includes(kw));
}
function temporalRerank(items) {
  const withTimestamp = items.filter((r) => r.updated_at);
  if (withTimestamp.length < items.length / 2) return items;
  return [...items].sort((a, b) => {
    const aMs = parseISOMs(a.updated_at);
    const bMs = parseISOMs(b.updated_at);
    return aMs - bMs;
  });
}
var SUPERSESSION_SCORE_PENALTY = 0.5;
var SUPERSESSION_MIN_OVERLAP = 0.35;
var SUPERSESSION_STALENESS_GAP_MS = 7 * 24 * 60 * 60 * 1e3;
function markSuperseded(items) {
  let supersededCount = 0;
  const alreadySuperseded = /* @__PURE__ */ new Set();
  for (let i = 0; i < items.length; i++) {
    if (alreadySuperseded.has(i)) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (alreadySuperseded.has(j)) continue;
      const a = items[i];
      const b = items[j];
      const overlap = topicTokenOverlap(a.label, b.label);
      if (overlap < SUPERSESSION_MIN_OVERLAP) continue;
      const aNeg = hasNegationMarker(a.label);
      const bNeg = hasNegationMarker(b.label);
      const aMs = parseISOMs(a.updated_at);
      const bMs = parseISOMs(b.updated_at);
      let olderIdx = null;
      if (aNeg !== bNeg) {
        olderIdx = aNeg ? j : i;
      } else if (aMs > 0 && bMs > 0 && Math.abs(aMs - bMs) > SUPERSESSION_STALENESS_GAP_MS) {
        olderIdx = aMs < bMs ? i : j;
      }
      if (olderIdx !== null) {
        items[olderIdx]._superseded = true;
        items[olderIdx]._heat *= SUPERSESSION_SCORE_PENALTY;
        alreadySuperseded.add(olderIdx);
        supersededCount++;
      }
    }
  }
  return supersededCount;
}
var TOPIC_SHIFT_THRESHOLD = 0.25;
var TOPIC_CACHE_TTL_MS = 5 * 60 * 1e3;
var STOPWORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "is",
  "it",
  "this",
  "that",
  "be",
  "as",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "can",
  "could",
  "will",
  "would",
  "should",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "me",
  "my",
  "your",
  "our",
  "their",
  "its",
  "not",
  "no",
  "so",
  "if",
  "what",
  "how",
  "when",
  "where",
  "which",
  "who",
  "from",
  "up",
  "about",
  "into",
  "just",
  "also",
  "any",
  "all",
  "than",
  "then",
  "there",
  "been",
  "more"
]);
function extractLastUserTurn(rawPrompt) {
  const cleaned = sanitizeRecallQuery(rawPrompt);
  if (!cleaned || cleaned.length < 3) return cleaned;
  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
  if (paragraphs.length === 0) return cleaned.substring(cleaned.length - 500);
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i];
    if (p.length < 10) continue;
    if (/^\{[\s\S]*\}$/.test(p)) continue;
    if (/^<[a-zA-Z]/.test(p) && /<\/[a-zA-Z]/.test(p)) continue;
    if (/^(you are|your task|system:|assistant:|\[system\])/i.test(p)) continue;
    if (/^\s*```/.test(p)) continue;
    return p.substring(0, 500);
  }
  return cleaned.substring(Math.max(0, cleaned.length - 500));
}
function sanitizeRecallQuery(raw) {
  let cleaned = raw;
  cleaned = cleaned.replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, "");
  cleaned = cleaned.replace(/Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, "");
  cleaned = cleaned.replace(/Replied message \(untrusted[^)]*\):\s*```json[\s\S]*?```\s*/gi, "");
  cleaned = cleaned.replace(/<<<EXTERNAL_UNTRUSTED_CONTENT[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, "");
  cleaned = cleaned.replace(/Untrusted context \(metadata[^)]*\):\s*/gi, "");
  cleaned = cleaned.replace(/^\[[^\]]{0,100}\]\s*/g, "");
  cleaned = cleaned.replace(/<@!?\d+>/g, "");
  cleaned = cleaned.replace(/@\w+/g, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned || raw;
}
function extractTopicTokens(text) {
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return new Set(tokens.slice(0, 40));
}
function topicOverlap(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared++;
  }
  return shared / Math.max(a.size, b.size);
}
async function expandQueryWithEntities(client, originalQuery, namespace, logger) {
  const tokens = Array.from(extractTopicTokens(originalQuery)).slice(0, 5);
  if (tokens.length === 0) return { extraMemories: [], expandedQuery: originalQuery };
  const entityData = await client.entity_context(tokens, namespace, 3);
  if (entityData.length === 0) return { extraMemories: [], expandedQuery: originalQuery };
  const synonymTerms = [];
  const extraMemories = [];
  const seenIds = /* @__PURE__ */ new Set();
  for (const entity of entityData) {
    for (const conn of entity.connections) {
      if (conn.name && conn.name.length > 2) {
        synonymTerms.push(conn.name);
      }
    }
    for (const mem of entity.related_memories) {
      if (mem.id && !seenIds.has(mem.id)) {
        seenIds.add(mem.id);
        extraMemories.push({
          id: mem.id,
          label: mem.pointer_summary,
          pointer_summary: mem.pointer_summary,
          memory_type: mem.memory_type,
          current_heat: mem.current_heat,
          _heat: mem.current_heat,
          _source: "entity_expansion"
        });
      }
    }
  }
  const uniqueSynonyms = [...new Set(synonymTerms)].slice(0, 5);
  const expandedQuery = uniqueSynonyms.length > 0 ? `${originalQuery} ${uniqueSynonyms.join(" ")}` : originalQuery;
  logger.info(`sulcus: query expansion found ${entityData.length} entity/entities, ${extraMemories.length} extra memories, ${uniqueSynonyms.length} synonym(s)`);
  return { extraMemories, expandedQuery };
}
var THIN_RECALL_THRESHOLD = 3;
function buildSdkRecallHandler(sulcusMem, namespace, maxResults, profileFrequency, logger, boostOnRecall = true, tokenBudget = 1e4, contextRebuild = true, contextWindowSize = 2e5) {
  let turnCount = 0;
  let profileCache = null;
  let recallCache = null;
  let qm_freshRecalls = 0;
  let qm_cacheHits = 0;
  let qm_totalItemsServed = 0;
  let qm_totalFails = 0;
  const QM_LOG_INTERVAL = 10;
  return async (event, _ctx) => {
    const rawPrompt = typeof event?.prompt === "string" ? event.prompt : "";
    if (!rawPrompt || rawPrompt.length < 5) return void 0;
    const effectiveNamespace = getEffectiveNamespace(namespace);
    const prompt = sanitizeRecallQuery(rawPrompt);
    if (!prompt || prompt.length < 3) return void 0;
    const recallQuery = extractLastUserTurn(rawPrompt);
    turnCount++;
    const sdkScale = applyAdaptiveScaling(turnCount, maxResults, tokenBudget);
    const throttled = applyContextWindowThrottle(rawPrompt.length, contextWindowSize, sdkScale, logger);
    if (throttled.selfMuted) {
      let selfMutedCore = "";
      if (coreMemoryCache === void 0) {
        try {
          coreMemoryCache = await sulcusMem.get_core_memory();
        } catch {
          coreMemoryCache = null;
        }
      }
      if (coreMemoryCache && Object.keys(coreMemoryCache).length > 0) {
        const coreLines = [];
        for (const [key, value] of Object.entries(coreMemoryCache)) {
          if (key === "namespace" || key === "updated_at" || key === "created_at") continue;
          if (typeof value === "string" && value.trim()) {
            coreLines.push(`  <${key}>${escapeXml(value)}</${key}>`);
          } else if (Array.isArray(value) && value.length > 0) {
            const items = value.map((v) => `    <item>${escapeXml(String(v))}</item>`).join("\n");
            coreLines.push(`  <${key}>
${items}
  </${key}>`);
          } else if (typeof value === "object" && value !== null) {
            const entries = Object.entries(value).filter(([, v]) => v !== null && v !== void 0 && String(v).trim()).map(([k, v]) => `    <${k}>${escapeXml(String(v))}</${k}>`).join("\n");
            if (entries) coreLines.push(`  <${key}>
${entries}
  </${key}>`);
          }
        }
        if (coreLines.length > 0) {
          const raw = `<core_memory>
${coreLines.join("\n")}
</core_memory>`;
          selfMutedCore = raw.length > CORE_MEMORY_MAX_CHARS ? raw.substring(0, CORE_MEMORY_MAX_CHARS) + "\n</core_memory>" : raw;
        }
      }
      const mutedComment = `<!-- sulcus: self-muted, context ${(rawPrompt.length / 4 / contextWindowSize * 100).toFixed(0)}% full -->`;
      return { prependContext: selfMutedCore ? `${selfMutedCore}
${mutedComment}` : mutedComment };
    }
    const effectiveMax = throttled.effectiveMax;
    const effectiveTokenBudget = throttled.effectiveTokenBudget;
    if (turnCount > 5) logger.debug?.(`sulcus: adaptive scaling (sdk turn ${turnCount}) \u2014 limit=${effectiveMax}, budget=${effectiveTokenBudget}`);
    const includeProfile = turnCount === 1 || turnCount % profileFrequency === 0;
    if (wasJustCompacted && contextRebuild) {
      wasJustCompacted = false;
      logger.info(`sulcus: POST-COMPACTION REBUILD \u2014 injecting full Sulcus context (budget: ${REBUILD_TOKEN_BUDGET} tokens)`);
      try {
        const rebuildQueries = [recallQuery];
        const promptHead = prompt.substring(0, 150).trim();
        if (promptHead.length > 10 && promptHead !== recallQuery) rebuildQueries.push(promptHead);
        const rebuildLimit = Math.min(30, maxResults * 3);
        const rawParallel = await Promise.allSettled(
          rebuildQueries.map((q) => sulcusMem.search_memory(q, rebuildLimit, namespace))
        );
        const seenRebuildIds = /* @__PURE__ */ new Set();
        const rebuildResults = [];
        for (const r of rawParallel) {
          if (r.status === "fulfilled") {
            const items = r.value?.results ?? [];
            for (const item of items) {
              const id = item.id;
              if (!seenRebuildIds.has(id)) {
                seenRebuildIds.add(id);
                rebuildResults.push(item);
              }
            }
          }
        }
        const sorted = rebuildResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const diverse = diversityFilter(sorted, 0.9);
        recallCache = null;
        if (diverse.length > 0) {
          const staleThresholdMs = 30 * 24 * 60 * 60 * 1e3;
          const nowMs = Date.now();
          const memXml = diverse.map((m) => {
            const id = m.id ?? "?";
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
            const heat = typeof m.current_heat === "number" ? m.current_heat.toFixed(3) : "?";
            const score = typeof m.score === "number" ? m.score.toFixed(3) : "?";
            const mtype = typeof m.memory_type === "string" ? m.memory_type : "unknown";
            const created = typeof m.created_at === "string" ? m.created_at : null;
            const stale = created !== null && nowMs - new Date(created).getTime() > staleThresholdMs;
            return `  <memory id="${id}" type="${mtype}" heat="${heat}" score="${score}"${stale ? ' age="stale"' : ""}>${escapeXml(content)}</memory>`;
          }).join("\n");
          const rebuildXml = [
            `<sulcus_context mode="post_compaction_rebuild" memories="${diverse.length}" budget="${REBUILD_TOKEN_BUDGET}">`,
            `  <!-- Context rebuilt from Sulcus after session compaction. Use this to restore working knowledge. -->`,
            `  <memories count="${diverse.length}">`,
            memXml,
            `  </memories>`,
            `  <session turn="${turnCount}" mode="compaction_rebuild" />`,
            `</sulcus_context>`
          ].join("\n");
          const budgetedRebuild = enforceContextBudget(rebuildXml, REBUILD_TOKEN_BUDGET);
          if (boostOnRecall) {
            boostRecalledMemories(sulcusMem, diverse, namespace, logger).catch(() => {
            });
          }
          recallQM.freshRecalls++;
          recallQM.totalItemsServed += diverse.length;
          logger.info(`sulcus: post-compaction rebuild injected ${diverse.length} memories (~${Math.round(budgetedRebuild.length / 4)} tokens)`);
          return { prependContext: budgetedRebuild };
        }
      } catch (e) {
        logger.warn(`sulcus: post-compaction rebuild failed: ${e instanceof Error ? e.message : String(e)} \u2014 falling back to normal recall`);
      }
    }
    const currentTokens = extractTopicTokens(prompt);
    const cacheExpired = recallCache !== null && Date.now() - recallCache.cachedAt > TOPIC_CACHE_TTL_MS;
    const overlap = recallCache !== null ? topicOverlap(currentTokens, recallCache.topicTokens) : 0;
    const topicShifted = recallCache === null || cacheExpired || overlap < TOPIC_SHIFT_THRESHOLD;
    let searchResults = [];
    if (!topicShifted && recallCache !== null) {
      searchResults = recallCache.results;
      qm_cacheHits++;
      recallQM.cacheHits++;
      logger.info(`sulcus: topic stable (overlap=${overlap.toFixed(2)}) \u2014 serving cached recall (turn ${turnCount})`);
    } else {
      if (recallCache !== null) {
        logger.info(`sulcus: TOPIC SHIFT detected (overlap=${overlap.toFixed(2)}) \u2014 fresh recall (turn ${turnCount})`);
      }
      try {
        const searchRes = await sulcusMem.search_memory(recallQuery, effectiveMax, effectiveNamespace);
        const vectorResults = searchRes?.results ?? [];
        let sdkExpanded = vectorResults;
        if (vectorResults.length < THIN_RECALL_THRESHOLD) {
          try {
            const { extraMemories: sdkExtraMem, expandedQuery: sdkExpandedQ } = await expandQueryWithEntities(
              sulcusMem,
              recallQuery,
              effectiveNamespace,
              logger
            );
            const sdkSeenIds = new Set(vectorResults.map((r) => r.id));
            const sdkNewExtras = sdkExtraMem.filter((m) => !sdkSeenIds.has(m.id));
            if (sdkNewExtras.length > 0) {
              sdkExpanded = [...vectorResults, ...sdkNewExtras];
              logger.info(`sulcus: sdk thin-recall expansion added ${sdkNewExtras.length} entity-graph memory/memories`);
            }
            if (sdkExpanded.length < THIN_RECALL_THRESHOLD && sdkExpandedQ !== recallQuery) {
              try {
                const sdkExpandedRes = await sulcusMem.search_memory(sdkExpandedQ, effectiveMax, effectiveNamespace);
                const sdkExpandedVec = sdkExpandedRes?.results ?? [];
                const sdkExpandedSeen = new Set(sdkExpanded.map((r) => r.id));
                const sdkExpandedNew = sdkExpandedVec.filter((r) => !sdkExpandedSeen.has(r.id));
                if (sdkExpandedNew.length > 0) {
                  sdkExpanded = [...sdkExpanded, ...sdkExpandedNew];
                  logger.info(`sulcus: sdk expanded query search added ${sdkExpandedNew.length} result(s)`);
                }
              } catch {
              }
            }
          } catch {
          }
        }
        searchResults = sdkExpanded;
        const seedIds = sdkExpanded.slice(0, 2).map((r) => r.id).filter(Boolean);
        if (seedIds.length > 0) {
          try {
            const neighborFetches = await Promise.allSettled(
              seedIds.map((id) => sulcusMem.graph_neighbors(id, 6))
            );
            const seenIds = new Set(sdkExpanded.map((r) => r.id));
            const graphExtras = [];
            for (const result of neighborFetches) {
              if (result.status !== "fulfilled") continue;
              for (const node of result.value) {
                const nodeId = node.id;
                if (!nodeId || seenIds.has(nodeId)) continue;
                const heat = node.current_heat ?? 0;
                if (heat < 0.2) continue;
                seenIds.add(nodeId);
                graphExtras.push(node);
              }
            }
            if (graphExtras.length > 0) {
              graphExtras.sort((a, b) => (b.current_heat ?? 0) - (a.current_heat ?? 0));
              const taggedExtras = graphExtras.slice(0, 4).map((r) => ({ ...r, _source: "graph" }));
              const sdkHopCount = taggedExtras.length;
              searchResults = [...sdkExpanded, ...taggedExtras];
              recallQM.graphHopContrib += sdkHopCount;
              recallQM.graphHopTurns++;
              logger.info(`sulcus: graph-hop added ${sdkHopCount} neighbours (seeds: ${seedIds.length})`);
            }
          } catch {
          }
        }
        qm_freshRecalls++;
        recallQM.freshRecalls++;
        recallCache = { results: searchResults, topicTokens: currentTokens, cachedAt: Date.now() };
      } catch (freshErr) {
        if (recallCache !== null) {
          logger.warn(`sulcus: fresh recall failed (${freshErr}), using stale cache`);
          searchResults = recallCache.results;
        } else {
          throw freshErr;
        }
      }
    }
    try {
      let preferences = [];
      let facts = [];
      if (includeProfile) {
        try {
          const prefRes = await sulcusMem.search_memory("user preference", Math.min(effectiveMax, 5), effectiveNamespace);
          const factRes = await sulcusMem.search_memory("fact data knowledge", Math.min(effectiveMax, 5), effectiveNamespace);
          preferences = (prefRes?.results ?? []).filter((r) => r.memory_type === "preference");
          facts = (factRes?.results ?? []).filter((r) => r.memory_type === "fact");
          profileCache = { preferences, facts, cachedAt: Date.now() };
        } catch {
        }
      } else if (profileCache) {
        preferences = profileCache.preferences;
        facts = profileCache.facts;
      }
      const profileIds = /* @__PURE__ */ new Set([
        ...preferences.map((r) => r.id),
        ...facts.map((r) => r.id)
      ]);
      const dedupedSearch = searchResults.filter((r) => !profileIds.has(r.id));
      const preDiversityItems = dedupedSearch.map((r) => ({
        ...r,
        label: r.label ?? r.pointer_summary ?? r.id ?? "",
        // Fix 2: prefer server fused_score over raw heat for ranking (Task 58)
        _heat: r.score ?? r.current_heat ?? 0
      }));
      preDiversityItems.sort((a, b) => b._heat - a._heat);
      const diverseSearch = diversityFilter(preDiversityItems, effectiveMax);
      const droppedByDiversity = preDiversityItems.length - diverseSearch.length;
      if (droppedByDiversity > 0) {
        logger.info(`sulcus: diversity filter dropped ${droppedByDiversity} near-duplicate(s)`);
      }
      const TYPE_PRIORITY = {
        procedural: 0,
        // how-tos = highest priority
        preference: 1,
        // user preferences = identity
        fact: 2,
        // stable data
        semantic: 3,
        // domain knowledge
        episodic: 4
        // events = lowest priority
      };
      diverseSearch.sort((a, b) => {
        const typeA = a.memory_type ?? "episodic";
        const typeB = b.memory_type ?? "episodic";
        const prioA = TYPE_PRIORITY[typeA] ?? 5;
        const prioB = TYPE_PRIORITY[typeB] ?? 5;
        if (prioA !== prioB) return prioA - prioB;
        return b._heat - a._heat;
      });
      const TOKEN_BUDGET = effectiveTokenBudget;
      const FIXED_OVERHEAD = 80;
      const profileBudgetTokens = Math.floor((TOKEN_BUDGET - FIXED_OVERHEAD) * 0.3);
      const recallBudgetTokens = TOKEN_BUDGET - FIXED_OVERHEAD - profileBudgetTokens;
      const profileItemsSorted = [...preferences, ...facts].map((r) => ({
        ...r,
        label: (r.label ?? r.pointer_summary ?? r.id ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        _heat: r.current_heat ?? 0
      })).sort((a, b) => b._heat - a._heat);
      const recallItemsSorted = diverseSearch.map((r) => ({
        ...r,
        label: (r.label ?? r.pointer_summary ?? r.id ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        _heat: r.score ?? r.current_heat ?? 0
      }));
      const sdkSupersededCount = markSuperseded(recallItemsSorted);
      if (sdkSupersededCount > 0) {
        logger.info(`sulcus: temporal supersession (sdk) marked ${sdkSupersededCount} memory/memories as superseded`);
        recallItemsSorted.sort((a, b) => b._heat - a._heat);
      }
      const budgetedProfile = enforceContextBudget(profileItemsSorted, TOKEN_BUDGET, FIXED_OVERHEAD + recallBudgetTokens);
      let budgetedRecall = enforceContextBudget(recallItemsSorted, TOKEN_BUDGET, FIXED_OVERHEAD + profileBudgetTokens);
      const sdkTemporalDetected = isTemporalQuery(recallQuery);
      if (sdkTemporalDetected) {
        budgetedRecall = temporalRerank(budgetedRecall);
        logger.info(`sulcus: temporal query detected (sdk) \u2014 re-ranking ${budgetedRecall.length} results chronologically`);
      }
      let sdkCoreMemoryXml = "";
      if (coreMemoryCache === void 0) {
        try {
          coreMemoryCache = await sulcusMem.get_core_memory();
          if (coreMemoryCache) {
            logger.info(`sulcus: core memory loaded (${JSON.stringify(coreMemoryCache).length} chars)`);
          }
        } catch {
          coreMemoryCache = null;
        }
      }
      if (coreMemoryCache && Object.keys(coreMemoryCache).length > 0) {
        const sdkCoreLines = [];
        for (const [key, value] of Object.entries(coreMemoryCache)) {
          if (key === "namespace" || key === "updated_at" || key === "created_at") continue;
          if (typeof value === "string" && value.trim()) {
            sdkCoreLines.push(`  <${key}>${escapeXml(value)}</${key}>`);
          } else if (Array.isArray(value) && value.length > 0) {
            const items = value.map((v) => `    <item>${escapeXml(String(v))}</item>`).join("\n");
            sdkCoreLines.push(`  <${key}>
${items}
  </${key}>`);
          } else if (typeof value === "object" && value !== null) {
            const entries = Object.entries(value).filter(([, v]) => v !== null && v !== void 0 && String(v).trim()).map(([k, v]) => `    <${k}>${escapeXml(String(v))}</${k}>`).join("\n");
            if (entries) sdkCoreLines.push(`  <${key}>
${entries}
  </${key}>`);
          }
        }
        if (sdkCoreLines.length > 0) {
          const raw = `<core_memory>
${sdkCoreLines.join("\n")}
</core_memory>`;
          sdkCoreMemoryXml = raw.length > CORE_MEMORY_MAX_CHARS ? raw.substring(0, CORE_MEMORY_MAX_CHARS) + "\n</core_memory>" : raw;
        }
      }
      const sections = [];
      if (sdkCoreMemoryXml) sections.push(sdkCoreMemoryXml);
      if (includeProfile && budgetedProfile.length > 0) {
        const profileElements = [];
        for (const r of budgetedProfile) {
          const mtype = r.memory_type === "fact" ? "fact" : "preference";
          const heat = r._heat.toFixed(2);
          profileElements.push(`  <item type="${mtype}" heat="${heat}">${r.label}</item>`);
        }
        if (profileElements.length > 0) {
          sections.push(`<profile>
${profileElements.join("\n")}
</profile>`);
        }
      }
      if (budgetedRecall.length > 0) {
        const recallElements = [];
        for (const r of budgetedRecall) {
          const heat = r._heat;
          const heatStr = heat.toFixed(2);
          const mtype = r.memory_type ?? "episodic";
          const updatedAt = r.updated_at;
          const ageStr = updatedAt ? formatRelativeTime(updatedAt) : "unknown";
          const staleAttr = isStaleMemory(updatedAt) ? ` stale="true"` : "";
          const supersededAttr = r._superseded ? ` superseded="true"` : "";
          recallElements.push(`  <memory type="${mtype}" heat="${heatStr}" age="${ageStr}"${staleAttr}${supersededAttr}>${r.label}</memory>`);
        }
        if (recallElements.length > 0) {
          const sdkRecallOrderAttr = sdkTemporalDetected ? ` order="chronological"` : "";
          sections.push(`<recall${sdkRecallOrderAttr}>
${recallElements.join("\n")}
</recall>`);
        }
      }
      if (sections.length === 0) return void 0;
      const guidance = "Background context from long-term memory. Use it silently to inform your understanding \u2014 only reference it when the conversation naturally calls for it.";
      const recallMode = !topicShifted ? "cached" : "fresh";
      const contextParts = [
        `<session turn="${turnCount}" mode="${recallMode}" />`,
        `<guidance>${guidance}</guidance>`
      ];
      contextParts.push(...sections);
      const context = `<sulcus_context token_budget="${TOKEN_BUDGET}" namespace="${effectiveNamespace}">
${contextParts.join("\n")}
</sulcus_context>`;
      const estimatedTokens = estimateTokens(context);
      logger.info(`sulcus: SDK recall injecting context (${context.length} chars, ~${estimatedTokens}/${TOKEN_BUDGET} tokens, turn ${turnCount}, profile: ${budgetedProfile.length}, recall: ${budgetedRecall.length})`);
      qm_totalItemsServed += budgetedRecall.length;
      if (budgetedRecall.length === 0) qm_totalFails++;
      recallQM.totalItemsServed += budgetedRecall.length;
      if (budgetedRecall.length === 0) recallQM.zeroResultTurns++;
      if (budgetedRecall.length > 0 && topicShifted) {
        const sdkAvgScore = budgetedRecall.reduce((s, r) => s + (r._heat ?? 0), 0) / budgetedRecall.length;
        recallQM.scoreSum += sdkAvgScore;
        recallQM.scoreTurns++;
      }
      if (turnCount % QM_LOG_INTERVAL === 0) {
        const qm_totalRecallTurns = qm_freshRecalls + qm_cacheHits;
        const qm_cacheHitRate = qm_totalRecallTurns > 0 ? (qm_cacheHits / qm_totalRecallTurns * 100).toFixed(1) : "0.0";
        const qm_avgItems = qm_totalRecallTurns > 0 ? (qm_totalItemsServed / qm_totalRecallTurns).toFixed(1) : "0.0";
        logger.info(
          `sulcus: [quality-metrics turn=${turnCount}] fresh=${qm_freshRecalls} cached=${qm_cacheHits} cache_hit_rate=${qm_cacheHitRate}% avg_items_served=${qm_avgItems} zero_result_turns=${qm_totalFails}`
        );
      }
      {
        const staleSDKItems = budgetedRecall.filter((r) => r.stale === true || r._stale === true);
        const graphSDKItems = budgetedRecall.filter((r) => r._source === "graph");
        inspectBuffer.lastRecall = {
          capturedAt: Date.now(),
          path: "sdk",
          turn: turnCount,
          query: prompt.substring(0, 200),
          fromCache: !topicShifted,
          itemsInjected: budgetedProfile.length + budgetedRecall.length,
          recallItems: budgetedRecall.map((r) => ({
            id: r.id ?? "",
            content_preview: (r.content ?? r.text ?? "").substring(0, 80),
            memory_type: r.memory_type ?? r.type ?? "unknown",
            heat: r.current_heat ?? r._heat ?? 0,
            score: r.score ?? null,
            stale: !!(r.stale ?? r._stale),
            source: r._source === "graph" ? "graph" : "semantic"
          })),
          profileItems: budgetedProfile.length,
          staleCount: staleSDKItems.length,
          graphHopCount: graphSDKItems.length,
          tokensBudget: TOKEN_BUDGET,
          tokensUsed: estimatedTokens
        };
      }
      if (boostOnRecall && budgetedRecall.length > 0) {
        boostRecalledMemories(sulcusMem, budgetedRecall, logger).catch(() => {
        });
      }
      if (topicShifted && sulcusMem instanceof SulcusCloudClient) {
        const recallIds = budgetedRecall.map((r) => r.id ?? "").filter(Boolean);
        const recallScores = budgetedRecall.map((r) => r._heat ?? 0);
        const recallSources = budgetedRecall.map(
          (r) => r._source === "graph" ? "graph" : "semantic"
        );
        const entityHints = Array.from(currentTokens).slice(0, 10);
        const semanticCount = recallSources.filter((s) => s === "semantic").length;
        const graphCount = recallSources.filter((s) => s === "graph").length;
        sulcusMem.recall_log({
          namespace,
          agent_id: namespace,
          query_text: prompt.substring(0, 500),
          memory_ids: recallIds,
          memory_scores: recallScores,
          memory_sources: recallSources,
          token_budget: TOKEN_BUDGET,
          tokens_used: estimatedTokens,
          candidates_total: searchResults.length,
          candidates_selected: recallIds.length,
          semantic_count: semanticCount,
          hot_count: graphCount,
          entity_count: entityHints.length,
          entity_hints: entityHints
        }).catch(() => {
        });
        logger.debug?.("sulcus: SIRU recall log posted");
      }
      return { prependContext: context };
    } catch (err) {
      qm_totalFails++;
      recallQM.zeroResultTurns++;
      logger.warn(`sulcus: SDK recall failed: ${err}`);
      return void 0;
    }
  };
}
function buildMemoryRuntime(sulcusMem, backendMode) {
  const searchManager = {
    status() {
      return {
        backend: "builtin",
        provider: "sulcus",
        model: backendMode === "cloud" ? "sulcus-cloud" : "sulcus-local",
        custom: { backendMode, transport: backendMode === "cloud" ? "remote" : "local" }
      };
    },
    async probeEmbeddingAvailability() {
      try {
        const ok = await sulcusMem.probe();
        return { ok };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "sulcus unreachable" };
      }
    },
    async probeVectorAvailability() {
      return true;
    },
    async sync() {
    },
    async close() {
    }
  };
  return {
    async getMemorySearchManager() {
      return { manager: searchManager };
    },
    resolveMemoryBackendConfig() {
      return { backend: "builtin" };
    },
    async closeAllMemorySearchManagers() {
    }
  };
}
function buildPromptSection(params) {
  const hasRecall = params.availableTools.has("memory_recall");
  const hasStore = params.availableTools.has("memory_store");
  if (!hasRecall && !hasStore) return [];
  const lines = [
    "## Memory (Sulcus)",
    "",
    "You have persistent thermodynamic memory powered by Sulcus.",
    "Relevant memories are automatically injected at the start of each conversation."
  ];
  if (hasRecall) lines.push("- Use `memory_recall` to search prior conversations, preferences, and facts.");
  if (hasStore) lines.push("- Use `memory_store` to save information the user asks you to remember.");
  if (params.availableTools.has("memory_status")) lines.push("- Use `memory_status` to check backend connection and hot nodes.");
  lines.push("");
  lines.push("Memory types: episodic (events, fast decay), semantic (knowledge, slow), preference (opinions, slower), procedural (how-tos, slowest), fact (data, slow)");
  return lines;
}
var toolDefinitions = {
  memory_recall: {
    schema: {
      name: "memory_recall",
      label: "Memory Recall",
      description: "Search Sulcus memory for relevant context",
      parameters: Type.Object({
        query: Type.String({ description: "Search query string." }),
        limit: Type.Optional(Type.Number({ default: 5, description: "Maximum number of results to return (1-10)." })),
        namespace: Type.Optional(Type.String({ description: "Namespace to search. Defaults to your own namespace." }))
      })
    },
    options: { name: "memory_recall" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      const searchNamespace = params.namespace ?? namespace;
      const res = await sulcusMem.search_memory(params.query, params.limit ?? 5, searchNamespace);
      const results = res?.results ?? [];
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        details: { results, backend: backendMode, namespace: searchNamespace }
      };
    }
  },
  memory_store: {
    schema: {
      name: "memory_store",
      label: "Memory Store",
      description: "Record information in Sulcus memory. Supports Markdown formatting. You control the memory type at creation time.",
      parameters: Type.Object({
        content: Type.String({ description: "Memory content. Supports Markdown formatting for structured content." }),
        memory_type: Type.Optional(Type.Union([
          Type.Literal("episodic"),
          Type.Literal("semantic"),
          Type.Literal("preference"),
          Type.Literal("procedural"),
          Type.Literal("fact")
        ], { description: "Memory type. Default: episodic" })),
        train: Type.Optional(Type.Boolean({ description: "Signal the SIU to learn from this manual store. Default: false" }))
      })
    },
    options: { name: "memory_store" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable, logger }) => async (_id, params) => {
      const content = params.content;
      if (isJunkMemory(content)) {
        logger.debug?.(`sulcus: filtered junk memory: "${content.substring(0, 50)}..."`);
        return { content: [{ type: "text", text: "Filtered: content looks like system noise, not a meaningful memory." }], details: { filtered: true } };
      }
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      const mtype = params.memory_type || "episodic";
      const storeHints = buildExtractionHints(mtype, namespace, "user_capture", content.substring(0, 200));
      const res = await sulcusMem.add_memory(content, mtype, storeHints);
      const nodeId = res?.id ?? "unknown";
      let trainResult = null;
      if (params.train === true) {
        try {
          await sulcusMem.request("POST", "/api/v2/siu/signal", {
            memory_id: nodeId,
            signal_type: "accept",
            corrected_store: true,
            corrected_type: mtype,
            content_snapshot: content,
            source: "plugin"
          });
          trainResult = "training signal submitted";
          logger.info(`sulcus: SIU training signal sent for memory ${nodeId} (store, ${mtype})`);
        } catch (e) {
          trainResult = `training signal failed: ${e instanceof Error ? e.message : e}`;
          logger.warn(`sulcus: SIU training signal failed: ${trainResult}`);
        }
      }
      return {
        content: [{ type: "text", text: `Stored [${mtype}] memory (id: ${nodeId}) \u2192 backend: ${backendMode}, namespace: ${namespace}${trainResult ? ` | SIU: ${trainResult}` : ""}` }],
        details: { ...res, id: nodeId, memory_type: mtype, backend: backendMode, namespace, train: trainResult }
      };
    }
  },
  memory_status: {
    schema: {
      name: "memory_status",
      label: "Memory Status",
      description: "Check Sulcus memory backend status: connection, namespace, capabilities, and hot nodes.",
      parameters: Type.Object({})
    },
    options: { name: "memory_status" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, storeLibPath, vectorsLibPath, wasmDir, isAvailable }) => async (_id, _params) => {
      if (!isAvailable || !sulcusMem) {
        return { content: [{ type: "text", text: JSON.stringify({ status: "unavailable", backend: backendMode, namespace, error: nativeLoader.error || "not loaded", storeLib: storeLibPath, vectorsLib: vectorsLibPath, wasmDir }, null, 2) }] };
      }
      try {
        const [statusInfo, hotNodes] = await Promise.all([
          sulcusMem.request("GET", "/api/v1/agent/memory/status").catch(() => null),
          sulcusMem.list_hot_nodes(20)
        ]);
        const nodeList = hotNodes?.nodes ?? [];
        const si = statusInfo;
        const qm_totalTurns = recallQM.freshRecalls + recallQM.cacheHits;
        const qm_cacheHitRate = qm_totalTurns > 0 ? parseFloat((recallQM.cacheHits / qm_totalTurns * 100).toFixed(1)) : null;
        const qm_avgRelevance = recallQM.scoreTurns > 0 ? parseFloat((recallQM.scoreSum / recallQM.scoreTurns).toFixed(3)) : null;
        const qm_graphHopRate = qm_totalTurns > 0 ? parseFloat((recallQM.graphHopTurns / qm_totalTurns * 100).toFixed(1)) : null;
        const qm_avgItemsServed = qm_totalTurns > 0 ? parseFloat((recallQM.totalItemsServed / qm_totalTurns).toFixed(1)) : null;
        const recallQuality = {
          total_turns: qm_totalTurns,
          fresh_recalls: recallQM.freshRecalls,
          cache_hits: recallQM.cacheHits,
          cache_hit_rate_pct: qm_cacheHitRate,
          avg_relevance_score: qm_avgRelevance,
          avg_items_served: qm_avgItemsServed,
          zero_result_turns: recallQM.zeroResultTurns,
          graph_hop_turns: recallQM.graphHopTurns,
          graph_hop_contrib_total: recallQM.graphHopContrib,
          graph_hop_rate_pct: qm_graphHopRate
        };
        let lastInjection = null;
        const lr = inspectBuffer.lastRecall;
        if (lr) {
          const recallHeats = lr.recallItems.map((i) => i.heat);
          const avgHeat = recallHeats.length > 0 ? parseFloat((recallHeats.reduce((s, h) => s + h, 0) / recallHeats.length).toFixed(3)) : null;
          const typeSet = new Set(lr.recallItems.map((i) => i.memory_type));
          const typeCoveragePct = lr.recallItems.length > 0 ? parseFloat((typeSet.size / 5 * 100).toFixed(1)) : null;
          const stalePct = lr.recallItems.length > 0 ? parseFloat((lr.staleCount / lr.recallItems.length * 100).toFixed(1)) : null;
          const ageMs = Date.now() - lr.capturedAt;
          lastInjection = {
            captured_ms_ago: ageMs,
            turn: lr.turn,
            path: lr.path,
            from_cache: lr.fromCache,
            query_preview: lr.query.slice(0, 100),
            items_injected: lr.itemsInjected,
            recall_items: lr.recallItems.length,
            profile_items: lr.profileItems,
            stale_count: lr.staleCount,
            stale_pct: stalePct,
            graph_hop_count: lr.graphHopCount,
            avg_heat_injected: avgHeat,
            type_coverage_pct: typeCoveragePct,
            types_present: Array.from(typeSet),
            token_budget: lr.tokensBudget,
            tokens_used: lr.tokensUsed,
            budget_utilization_pct: lr.tokensBudget > 0 ? parseFloat((lr.tokensUsed / lr.tokensBudget * 100).toFixed(1)) : null
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "ok", backend: backendMode, namespace, ...si?.capabilities ? { capabilities: si.capabilities } : {}, ...si?.stats ? { stats: si.stats } : {}, hot_node_count: nodeList.length, hot_nodes: nodeList, recall_quality: recallQuality, last_injection: lastInjection }, null, 2) }],
          details: { status: "ok", backend: backendMode, namespace, count: nodeList.length }
        };
      } catch (e) {
        return { content: [{ type: "text", text: JSON.stringify({ status: "error", backend: backendMode, namespace, error: e instanceof Error ? e.message : String(e) }, null, 2) }] };
      }
    }
  },
  consolidate: {
    schema: {
      name: "consolidate",
      label: "Memory Consolidate",
      description: "Consolidate cold memories: merges, prunes, or archives nodes below the given heat threshold.",
      parameters: Type.Object({ min_heat: Type.Optional(Type.Number({ default: 0.1, description: "Heat threshold (0.0\u20131.0)." })) })
    },
    options: { name: "consolidate" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      const res = await sulcusMem.consolidate(params.min_heat ?? 0.1);
      return { content: [{ type: "text", text: JSON.stringify({ result: res, backend: backendMode, namespace }, null, 2) }], details: { result: res, backend: backendMode, namespace } };
    }
  },
  export_markdown: {
    schema: {
      name: "export_markdown",
      label: "Export Memory (Markdown)",
      description: "Export all memories in the current namespace as a Markdown document.",
      parameters: Type.Object({})
    },
    options: { name: "export_markdown" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, _params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      const markdown = await sulcusMem.export_markdown();
      return { content: [{ type: "text", text: markdown }], details: { backend: backendMode, namespace, length: markdown.length } };
    }
  },
  import_markdown: {
    schema: {
      name: "import_markdown",
      label: "Import Memory (Markdown)",
      description: "Import memories from a Markdown document into the current namespace.",
      parameters: Type.Object({ text: Type.String({ description: "Markdown content to import." }) })
    },
    options: { name: "import_markdown" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      const res = await sulcusMem.import_markdown(params.text);
      return { content: [{ type: "text", text: JSON.stringify({ result: res, backend: backendMode, namespace }, null, 2) }], details: { result: res, backend: backendMode, namespace } };
    }
  },
  evaluate_triggers: {
    schema: {
      name: "evaluate_triggers",
      label: "Evaluate Memory Triggers",
      description: "Evaluate reactive memory triggers against an event and context.",
      parameters: Type.Object({
        event: Type.String({ description: "Event name to evaluate triggers against (e.g. 'agent_end', 'user_message')." }),
        context_json: Type.Optional(Type.String({ description: "JSON string of additional context." }))
      })
    },
    options: { name: "evaluate_triggers" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      const res = await sulcusMem.evaluate_triggers(params.event, params.context_json ?? "{}");
      return { content: [{ type: "text", text: JSON.stringify({ result: res, backend: backendMode, namespace }, null, 2) }], details: { result: res, backend: backendMode, namespace } };
    }
  },
  memory_delete: {
    schema: {
      name: "memory_delete",
      label: "Delete Memory",
      description: "Delete a memory node by ID. With train=true (default), trains SIVU to reject similar content.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory node ID to delete." }),
        train: Type.Optional(Type.Boolean({ default: true, description: "Train SIVU to reject similar content (default true)." }))
      })
    },
    options: { name: "memory_delete" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      const train = params.train !== false;
      const res = await sulcusMem.delete_memory(params.id, train);
      return {
        content: [{ type: "text", text: `Deleted memory ${params.id}${train ? " (trained SIVU to reject similar)" : ""}. Backend: ${backendMode}, namespace: ${namespace}` }],
        details: { id: params.id, trained: train, result: res, backend: backendMode, namespace }
      };
    }
  },
  memory_get: {
    schema: {
      name: "memory_get",
      label: "Get Memory",
      description: "Fetch a specific memory by its UUID. Returns full memory details including content, type, heat, graph edges, and metadata.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory node UUID." })
      })
    },
    options: { name: "memory_get" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("memory_get requires cloud backend");
      const memId = params.id;
      const res = await sulcusMem.get_memory(memId);
      if (!res) return { content: [{ type: "text", text: `Memory ${memId} not found.` }], details: { found: false, id: memId } };
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        details: { ...res, backend: backendMode, namespace }
      };
    }
  },
  memory_list: {
    schema: {
      name: "memory_list",
      label: "List Memories",
      description: "Browse memories with optional filters. Returns paginated results sorted by heat (hottest first). Use this to explore what Sulcus knows without a search query.",
      parameters: Type.Object({
        page: Type.Optional(Type.Number({ default: 1, description: "Page number (1-indexed)." })),
        page_size: Type.Optional(Type.Number({ default: 20, description: "Results per page (1-100).", minimum: 1, maximum: 100 })),
        memory_type: Type.Optional(Type.Union([
          Type.Literal("episodic"),
          Type.Literal("semantic"),
          Type.Literal("preference"),
          Type.Literal("procedural"),
          Type.Literal("fact")
        ], { description: "Filter by memory type." })),
        pinned: Type.Optional(Type.Boolean({ description: "Filter by pinned status." })),
        sort_by: Type.Optional(Type.Union([
          Type.Literal("current_heat"),
          Type.Literal("created_at"),
          Type.Literal("updated_at")
        ], { description: "Sort field (default: current_heat)." })),
        sort_order: Type.Optional(Type.Union([
          Type.Literal("asc"),
          Type.Literal("desc")
        ], { description: "Sort order (default: desc)." }))
      })
    },
    options: { name: "memory_list" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("memory_list requires cloud backend");
      const page = params.page ?? 1;
      const pageSize = Math.min(100, Math.max(1, params.page_size ?? 20));
      const res = await sulcusMem.list_memories({
        page,
        page_size: pageSize,
        memory_type: params.memory_type,
        pinned: params.pinned,
        sort_by: params.sort_by ?? "current_heat",
        sort_order: params.sort_order ?? "desc",
        namespace
      });
      const summary = `Page ${page} \u2014 ${res.items.length} memories${res.total !== void 0 ? ` (${res.total} total)` : ""}`;
      return {
        content: [{ type: "text", text: summary + "\n" + JSON.stringify(res.items, null, 2) }],
        details: { page, page_size: pageSize, count: res.items.length, total: res.total, backend: backendMode, namespace }
      };
    }
  },
  memory_update: {
    schema: {
      name: "memory_update",
      label: "Update Memory",
      description: "Update fields on an existing memory in-place. Preserves graph edges and history. More surgical than delete+re-store.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory node UUID to update." }),
        content: Type.Optional(Type.String({ description: "New content text (replaces existing)." })),
        memory_type: Type.Optional(Type.Union([
          Type.Literal("episodic"),
          Type.Literal("semantic"),
          Type.Literal("preference"),
          Type.Literal("procedural"),
          Type.Literal("fact")
        ], { description: "New memory type classification." })),
        is_pinned: Type.Optional(Type.Boolean({ description: "Pin (prevent decay) or unpin." })),
        heat: Type.Optional(Type.Number({ description: "Set heat directly (0.0-1.0).", minimum: 0, maximum: 1 }))
      })
    },
    options: { name: "memory_update" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable, logger }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("memory_update requires cloud backend");
      const memId = params.id;
      const updates = {};
      if (params.content !== void 0) updates.label = params.content;
      if (params.memory_type !== void 0) updates.memory_type = params.memory_type;
      if (params.is_pinned !== void 0) updates.is_pinned = params.is_pinned;
      if (params.heat !== void 0) updates.current_heat = params.heat;
      if (Object.keys(updates).length === 0) {
        return { content: [{ type: "text", text: "No fields to update. Provide at least one of: content, memory_type, is_pinned, heat." }] };
      }
      const res = await sulcusMem.update_memory(memId, updates);
      const fields = Object.keys(updates).join(", ");
      logger.info(`sulcus: memory_update \u2014 updated ${memId} (fields: ${fields})`);
      return {
        content: [{ type: "text", text: `Updated memory ${memId} (fields: ${fields}). Backend: ${backendMode}, namespace: ${namespace}` }],
        details: { id: memId, updated_fields: Object.keys(updates), result: res, backend: backendMode, namespace }
      };
    }
  },
  memory_profile: {
    schema: {
      name: "memory_profile",
      label: "Memory Profile",
      description: "Show a rich snapshot of this agent's memory health: type distribution, heat curve, top hot nodes, top preferences/facts, and graph stats. Call this to understand what Sulcus knows and how active the memory is.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: "Max hot nodes to surface (default 10).", minimum: 1, maximum: 50 }))
      })
    },
    options: { name: "memory_profile" },
    makeExecute: ({ sulcusMem, backendMode, namespace, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) {
        return { content: [{ type: "text", text: `Memory profile unavailable \u2014 backend: ${backendMode}, namespace: ${namespace}` }] };
      }
      const hotLimit = Math.min(50, Math.max(1, params?.limit ?? 10));
      try {
        const [statusRes, hotRes, prefRes, factRes] = await Promise.allSettled([
          sulcusMem.request("GET", "/api/v1/agent/memory/status").catch(() => null),
          sulcusMem.list_hot_nodes(hotLimit),
          sulcusMem.search_memory("preference", hotLimit),
          sulcusMem.search_memory("fact", hotLimit)
        ]);
        const status = statusRes.status === "fulfilled" ? statusRes.value : null;
        const hotNodes = (hotRes.status === "fulfilled" ? hotRes.value?.nodes : []) ?? [];
        const preferences = (prefRes.status === "fulfilled" ? prefRes.value?.results : []) ?? [];
        const facts = (factRes.status === "fulfilled" ? factRes.value?.results : []) ?? [];
        const prefItems = preferences.filter(
          (r) => (r.memory_type ?? r.type) === "preference"
        ).slice(0, 5);
        const factItems = facts.filter(
          (r) => (r.memory_type ?? r.type) === "fact"
        ).slice(0, 5);
        const stats = status?.stats;
        const caps = status?.capabilities;
        const lines = [];
        lines.push(`## \u{1F9E0} Sulcus Memory Profile`);
        lines.push(`**Namespace:** ${namespace} | **Backend:** ${backendMode}`);
        lines.push("");
        if (stats) {
          const total = stats.total_nodes ?? stats.total ?? "?";
          const hot = stats.hot_nodes ?? "?";
          const cold = stats.cold_nodes ?? "?";
          const avgHeat = typeof stats.average_heat === "number" ? (stats.average_heat * 100).toFixed(1) + "%" : "?";
          lines.push(`### Memory Stats`);
          lines.push(`- **Total nodes:** ${total}`);
          lines.push(`- **Hot / Cold:** ${hot} hot / ${cold} cold`);
          lines.push(`- **Average heat:** ${avgHeat}`);
          if (stats.memory_types && Array.isArray(stats.memory_types)) {
            const types = stats.memory_types.sort((a, b) => b.count - a.count).map((t) => `${t.type}: ${t.count}`).join(" | ");
            lines.push(`- **By type:** ${types}`);
          }
          lines.push("");
        }
        if (caps) {
          const enabled = Object.entries(caps).filter(([, v]) => v === true).map(([k]) => k).join(", ");
          if (enabled) lines.push(`**Active capabilities:** ${enabled}
`);
        }
        if (hotNodes.length > 0) {
          lines.push(`### \u{1F525} Top Hot Nodes (${hotNodes.length})`);
          for (const n of hotNodes.slice(0, hotLimit)) {
            const heat = typeof n.current_heat === "number" ? (n.current_heat * 100).toFixed(0) + "%" : "?";
            const mtype = n.memory_type ?? n.type ?? "?";
            const label = (n.summary ?? n.label ?? n.content ?? "").slice(0, 80);
            lines.push(`- [${heat} ${mtype}] ${label}`);
          }
          lines.push("");
        }
        if (prefItems.length > 0) {
          lines.push(`### \u{1F4CC} Active Preferences`);
          for (const p of prefItems) {
            const heat = typeof p.current_heat === "number" ? (p.current_heat * 100).toFixed(0) + "%" : "?";
            const label = (p.summary ?? p.label ?? p.content ?? "").slice(0, 100);
            lines.push(`- [${heat}] ${label}`);
          }
          lines.push("");
        }
        if (factItems.length > 0) {
          lines.push(`### \u{1F4DA} Active Facts`);
          for (const f of factItems) {
            const heat = typeof f.current_heat === "number" ? (f.current_heat * 100).toFixed(0) + "%" : "?";
            const label = (f.summary ?? f.label ?? f.content ?? "").slice(0, 100);
            lines.push(`- [${heat}] ${label}`);
          }
          lines.push("");
        }
        const summary = lines.join("\n");
        return {
          content: [{ type: "text", text: summary }],
          details: { backend: backendMode, namespace, hot_count: hotNodes.length, pref_count: prefItems.length, fact_count: factItems.length }
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Memory profile error: ${e instanceof Error ? e.message : String(e)}` }] };
      }
    }
  },
  siu_label: {
    schema: {
      name: "siu_label",
      label: "SIU Label",
      description: "Classify text using SIU v2 \u2014 returns SIVU store/reject decision and SICU memory type classification.",
      parameters: Type.Object({
        text: Type.String({ description: "Text to classify." }),
        classify_only: Type.Optional(Type.Boolean({ description: "Skip SIVU quality gate, only run SICU type classification." }))
      })
    },
    options: { name: "siu_label" },
    makeExecute: ({ siuRequest, logger }) => async (_id, params) => {
      if (!siuRequest) return { content: [{ type: "text", text: "SIU label requires cloud backend (serverUrl + apiKey)." }] };
      try {
        const res = await siuRequest("POST", "/api/v2/siu/label", { text: params.text, classify_only: params.classify_only ?? false });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`sulcus: siu_label failed: ${msg}`);
        return { content: [{ type: "text", text: `SIU label failed: ${msg}` }] };
      }
    }
  },
  siu_status: {
    schema: {
      name: "siu_status",
      label: "SIU Status",
      description: "Check SIU v2 model availability, deployed versions, and training signal statistics.",
      parameters: Type.Object({})
    },
    options: { name: "siu_status" },
    makeExecute: ({ siuRequest, logger }) => async (_id, _params) => {
      if (!siuRequest) return { content: [{ type: "text", text: "SIU status requires cloud backend." }] };
      try {
        const res = await siuRequest("GET", "/api/v2/siu/status");
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`sulcus: siu_status failed: ${msg}`);
        return { content: [{ type: "text", text: `SIU status failed: ${msg}` }] };
      }
    }
  },
  siu_retrain: {
    schema: {
      name: "siu_retrain",
      label: "SIU Retrain",
      description: "Trigger an async retrain of SIU v2 models using accumulated training signals.",
      parameters: Type.Object({})
    },
    options: { name: "siu_retrain" },
    makeExecute: ({ siuRequest, logger }) => async (_id, _params) => {
      if (!siuRequest) return { content: [{ type: "text", text: "SIU retrain requires cloud backend." }] };
      try {
        const res = await siuRequest("POST", "/api/v2/siu/retrain");
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`sulcus: siu_retrain failed: ${msg}`);
        return { content: [{ type: "text", text: `SIU retrain failed: ${msg}` }] };
      }
    }
  },
  trigger_feedback: {
    schema: {
      name: "trigger_feedback",
      label: "Trigger Feedback",
      description: "Record feedback on a trigger fire (for SITU training).",
      parameters: Type.Object({
        feedback_type: Type.String({ description: 'One of: "false_positive", "false_negative", "correct", "wrong_action"' }),
        trigger_id: Type.Optional(Type.String({ description: "UUID of the trigger rule" })),
        trigger_log_id: Type.Optional(Type.String({ description: "UUID of the trigger fire log entry" })),
        event_type: Type.Optional(Type.String({ description: "Event type: memory_created, heat_threshold, recall, etc." })),
        memory_id: Type.Optional(Type.String({ description: "UUID of the memory involved" })),
        expected_action: Type.Optional(Type.String({ description: "What should have happened: fire, no_fire, different_action" })),
        notes: Type.Optional(Type.String({ description: "Free-text explanation of the feedback" }))
      })
    },
    options: { name: "trigger_feedback" },
    makeExecute: ({ siuRequest, logger }) => async (_id, params) => {
      if (!siuRequest) return { content: [{ type: "text", text: "Trigger feedback requires cloud backend." }] };
      try {
        const res = await siuRequest("POST", "/api/v1/triggers/feedback", params);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], details: res };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`sulcus: trigger_feedback failed: ${msg}`);
        return { content: [{ type: "text", text: `Trigger feedback failed: ${msg}` }] };
      }
    }
  },
  session_store: {
    schema: {
      name: "session_store",
      label: "Session Store",
      description: "Store ephemeral context for the current conversation only. Automatically purged when the session ends. Use this for short-term scratch-pad notes, intermediate reasoning, or context that's only relevant to this exchange.",
      parameters: Type.Object({
        content: Type.String({ description: "Content to store for this session." }),
        memory_type: Type.Optional(Type.Union([
          Type.Literal("episodic"),
          Type.Literal("semantic"),
          Type.Literal("preference"),
          Type.Literal("procedural"),
          Type.Literal("fact")
        ], { description: "Memory type classification. Default: episodic" }))
      })
    },
    options: { name: "session_store" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable, logger }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      const content = params.content;
      if (isJunkMemory(content)) {
        return { content: [{ type: "text", text: "Filtered: content looks like system noise." }], details: { filtered: true } };
      }
      const mtype = params.memory_type || "episodic";
      const sessionNs = `session:${CURRENT_SESSION_ID}`;
      const hints = buildExtractionHints(mtype, namespace, "user_capture", content.substring(0, 200));
      const res = await sulcusMem.add_memory(content, mtype, hints);
      const nodeId = res?.id ?? "unknown";
      if (nodeId !== "unknown" && sulcusMem instanceof SulcusCloudClient) {
        await sulcusMem.request("PATCH", `/api/v1/agent/memory/${nodeId}`, {
          current_heat: 0.95
          // Tag with session namespace via a search-scoped namespace field
        }).catch(() => {
        });
      }
      sessionMemoryIds.add(nodeId);
      logger.info(`sulcus: session_store \u2014 stored [${mtype}] for session ${CURRENT_SESSION_ID} (id: ${nodeId})`);
      return {
        content: [{ type: "text", text: `Stored session memory [${mtype}] (id: ${nodeId}) \u2014 will be purged at session end.` }],
        details: { id: nodeId, memory_type: mtype, session_id: CURRENT_SESSION_ID, backend: backendMode, namespace: sessionNs }
      };
    }
  },
  session_recall: {
    schema: {
      name: "session_recall",
      label: "Session Recall",
      description: "Search ephemeral context stored in the current conversation with session_store. Returns only memories from this session \u2014 nothing from prior sessions.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query string." }),
        limit: Type.Optional(Type.Number({ default: 5, description: "Maximum results (1-10)." }))
      })
    },
    options: { name: "session_recall" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (sessionMemoryIds.size === 0) {
        return { content: [{ type: "text", text: "No session memories stored yet. Use session_store to add ephemeral context." }], details: { results: [], session_id: CURRENT_SESSION_ID } };
      }
      const limit = Math.min(10, Math.max(1, params.limit ?? 5));
      const res = await sulcusMem.search_memory(params.query, limit * 3, namespace);
      const allResults = res?.results ?? [];
      const sessionResults = allResults.filter((r) => sessionMemoryIds.has(r.id)).slice(0, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(sessionResults, null, 2) }],
        details: { results: sessionResults, session_id: CURRENT_SESSION_ID, session_count: sessionMemoryIds.size, backend: backendMode }
      };
    }
  },
  memory_inspect: {
    schema: {
      name: "memory_inspect",
      label: "Memory Inspect",
      description: "Debug window into what Sulcus is actually doing. Shows what was injected in the last recall, what the output/tool guard scanned, what was blocked and why, and the last N guardrail events. Use this to verify Sulcus is working correctly.",
      parameters: Type.Object({})
    },
    options: { name: "memory_inspect" },
    makeExecute: (_deps) => async (_id, _params) => {
      const now = Date.now();
      const recall = inspectBuffer.lastRecall;
      const recallSection = recall ? {
        captured_ago_s: Math.round((now - recall.capturedAt) / 1e3),
        path: recall.path,
        turn: recall.turn,
        query_preview: recall.query,
        from_cache: recall.fromCache,
        items_injected: recall.itemsInjected,
        profile_items: recall.profileItems,
        recall_item_count: recall.recallItems.length,
        stale_items: recall.staleCount,
        graph_hop_items: recall.graphHopCount,
        tokens_used: recall.tokensUsed,
        tokens_budget: recall.tokensBudget,
        recall_items: recall.recallItems.map((r) => ({
          id: r.id,
          preview: r.content_preview,
          type: r.memory_type,
          heat: r.heat.toFixed(3),
          score: r.score !== null ? r.score.toFixed(4) : null,
          stale: r.stale,
          source: r.source
        }))
      } : { status: "no_recall_yet", note: "No recall injection has occurred this session yet." };
      const events = inspectBuffer.guardrailEvents.slice().reverse().map((e) => ({
        ago_s: Math.round((now - e.capturedAt) / 1e3),
        guard: e.guard,
        event: e.eventType,
        action: e.action,
        details: e.details,
        ...e.toolName ? { tool: e.toolName } : {},
        ...e.severity ? { severity: e.severity } : {}
      }));
      const result = {
        last_recall: recallSection,
        guardrail_events: events.length > 0 ? events : [{ status: "none", note: "No guardrail events this session." }],
        guardrail_event_count: inspectBuffer.guardrailEvents.length
      };
      const lines = [
        "## U0001f50d Sulcus Inspect",
        "",
        "### Last Recall Injection",
        "```json",
        JSON.stringify(recallSection, null, 2),
        "```",
        "",
        "### Guardrail Events (most recent first)",
        "```json",
        JSON.stringify(events.length > 0 ? events : [{ status: "none" }], null, 2),
        "```"
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: result
      };
    }
  },
  guardrail_status: {
    schema: {
      name: "guardrail_status",
      label: "Guardrail Status",
      description: "Returns current guardrail configuration: outputGuard enabled/disabled, which rules are active (PII/preferences/custom), last 5 blocked events with reasons, preference keywords cached, negative prefs count. Use this to verify the guard is working and what it's watching.",
      parameters: Type.Object({})
    },
    options: { name: "guardrail_status" },
    makeExecute: (_deps) => async (_id, _params) => {
      const now = Date.now();
      if (!guardrailStatus) {
        return {
          content: [{ type: "text", text: "## \u{1F6E1}\uFE0F Guardrail Status\n\nPlugin not fully initialized yet. Try again after the first turn." }],
          details: { status: "not_initialized" }
        };
      }
      const gs = guardrailStatus;
      const negCount = gs.negPrefCount();
      const negCachedAt = gs.negPrefCachedAt();
      const negCacheAge = negCachedAt ? Math.round((now - negCachedAt) / 1e3) : null;
      const blockedEvents = inspectBuffer.guardrailEvents.slice().reverse().filter((e) => e.action === "block" || e.action === "redact" || e.action === "replace" || e.action === "warn" || e.eventType.includes("violation") || e.eventType.includes("blocked")).slice(0, 5).map((e) => ({
        ago_s: Math.round((now - e.capturedAt) / 1e3),
        guard: e.guard,
        event: e.eventType,
        action: e.action,
        details: e.details,
        ...e.toolName ? { tool: e.toolName } : {},
        ...e.severity ? { severity: e.severity } : {}
      }));
      const result = {
        output_guard: {
          enabled: gs.outputGuard.enabled,
          pii: gs.outputGuard.pii,
          preference_violation: gs.outputGuard.preferenceViolation,
          fail_mode: gs.outputGuard.failMode,
          audit_trail: gs.outputGuard.auditTrail
        },
        tool_guard: {
          enabled: gs.toolGuard.enabled,
          sensitive_tools: gs.toolGuard.sensitiveTools,
          allowlist: gs.toolGuard.allowlist,
          blocklist: gs.toolGuard.blocklist,
          objective_check: gs.toolGuard.objectiveCheck,
          require_approval_threshold: gs.toolGuard.requireApprovalThreshold,
          fail_mode: gs.toolGuard.failMode,
          audit_trail: gs.toolGuard.auditTrail
        },
        neg_pref_cache: {
          count: negCount,
          cached_age_s: negCacheAge,
          note: negCount === 0 ? "No negative preferences cached (cache empty or not yet loaded)" : `${negCount} negative preference(s) cached`
        },
        recent_blocked_events: blockedEvents.length > 0 ? blockedEvents : [{ status: "none", note: "No blocks/violations this session" }]
      };
      const ogStatus = gs.outputGuard.enabled ? `\u2705 enabled (PII: ${gs.outputGuard.pii.enabled ? "on" : "off"}, prefViolation: ${gs.outputGuard.preferenceViolation.enabled ? "on" : "off"})` : `\u274C disabled (set guardrails.outputGuard.enabled=true to activate)`;
      const tgStatus = gs.toolGuard.enabled ? `\u2705 enabled (objectiveCheck: ${gs.toolGuard.objectiveCheck ? "on" : "off"}, threshold: ${gs.toolGuard.requireApprovalThreshold})` : `\u274C disabled (set guardrails.toolGuard.enabled=true to activate)`;
      const lines = [
        "## \u{1F6E1}\uFE0F Guardrail Status",
        "",
        `**Output Guard:** ${ogStatus}`,
        ...gs.outputGuard.enabled ? [
          `  - PII patterns: ${gs.outputGuard.pii.patterns.join(", ")}`,
          `  - PII action: ${gs.outputGuard.pii.onViolation} (reversible: ${gs.outputGuard.pii.reversible})`,
          `  - Preference violation action: ${gs.outputGuard.preferenceViolation.onViolation}`,
          `  - Fail mode: ${gs.outputGuard.failMode}`
        ] : [],
        "",
        `**Tool Guard:** ${tgStatus}`,
        ...gs.toolGuard.enabled ? [
          `  - Sensitive tools: ${gs.toolGuard.sensitiveTools.join(", ")}`,
          `  - Allowlist: ${gs.toolGuard.allowlist.length > 0 ? gs.toolGuard.allowlist.join(", ") : "(none)"}`,
          `  - Blocklist: ${gs.toolGuard.blocklist.length > 0 ? gs.toolGuard.blocklist.join(", ") : "(none)"}`,
          `  - Approval threshold: ${gs.toolGuard.requireApprovalThreshold}`,
          `  - Fail mode: ${gs.toolGuard.failMode}`
        ] : [],
        "",
        `**Negative Pref Cache:** ${negCount} prefs cached${negCacheAge !== null ? `, ${negCacheAge}s ago` : ""}`,
        "",
        `**Recent Blocks (last 5):**`,
        "```json",
        JSON.stringify(blockedEvents.length > 0 ? blockedEvents : [{ status: "none" }], null, 2),
        "```"
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: result
      };
    }
  },
  __sulcus_workflow__: {
    schema: {
      name: "__sulcus_workflow__",
      label: "Sulcus Workflow",
      description: "Call this when you are unsure what to do next with Sulcus memory tools. Returns a step-by-step workflow checklist so you always know the right action.",
      parameters: Type.Object({})
    },
    options: { name: "__sulcus_workflow__" },
    makeExecute: (_deps) => async (_id, _params) => {
      const workflow = [
        { step: 1, action: "search first", tool: "memory_recall", description: "Before starting work, search memory for relevant context from prior sessions." },
        { step: 2, action: "store decisions/patterns/learnings", tool: "memory_store", description: "After significant work, store important decisions, patterns, corrections, or learnings." },
        { step: 3, action: "boost important memories", tool: "PATCH /api/v1/agent/memory/:id", description: "Use PATCH to set current_heat=0.9 on memories that should persist longer (memory_boost not yet exposed as a tool)." },
        { step: 4, action: "check triggers", tool: "evaluate_triggers", description: "Evaluate reactive rules to see if any triggers should fire based on current context." },
        { step: 5, action: "export if needed", tool: "export_markdown", description: "Export all memories as Markdown for backup or review." }
      ];
      return {
        content: [{ type: "text", text: JSON.stringify(workflow, null, 2) }],
        details: { workflow }
      };
    }
  },
  graph_explore: {
    schema: {
      name: "graph_explore",
      label: "Graph Explore",
      description: "Explore the knowledge graph around a memory (neighbors mode) or query temporal connections (temporal mode).",
      parameters: Type.Object({
        mode: Type.Union([Type.Literal("neighbors"), Type.Literal("temporal")], { description: "Exploration mode: 'neighbors' for graph edges around a memory, 'temporal' for time-based connections." }),
        memory_id: Type.Optional(Type.String({ description: "Memory node UUID. Required for neighbors mode." })),
        query: Type.Optional(Type.String({ description: "Search query for temporal mode." })),
        time_from: Type.Optional(Type.String({ description: "ISO 8601 start time for temporal range filter." })),
        time_to: Type.Optional(Type.String({ description: "ISO 8601 end time for temporal range filter." })),
        limit: Type.Optional(Type.Number({ default: 10, description: "Max results to return (default 10).", minimum: 1, maximum: 50 }))
      })
    },
    options: { name: "graph_explore" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("graph_explore requires cloud backend");
      const mode = params.mode;
      const limit = params.limit ?? 10;
      if (mode === "neighbors") {
        const memoryId = params.memory_id;
        if (!memoryId) return { content: [{ type: "text", text: "memory_id is required for neighbors mode." }] };
        const neighbors = await sulcusMem.graph_neighbors(memoryId, limit);
        return {
          content: [{ type: "text", text: JSON.stringify(neighbors, null, 2) }],
          details: { mode, memory_id: memoryId, count: neighbors.length, backend: backendMode, namespace }
        };
      } else {
        const query = params.query;
        if (!query) return { content: [{ type: "text", text: "query is required for temporal mode." }] };
        const results = await sulcusMem.graph_temporal(
          query,
          params.time_from,
          params.time_to,
          limit
        );
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          details: { mode, query, count: results.length, backend: backendMode, namespace }
        };
      }
    }
  },
  memory_conflicts: {
    schema: {
      name: "memory_conflicts",
      label: "Memory Conflicts",
      description: "List detected memory conflicts or resolve a specific conflict.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("resolve")], { description: "Action: 'list' to see conflicts, 'resolve' to resolve one." }),
        id: Type.Optional(Type.String({ description: "Conflict UUID. Required for resolve action." })),
        resolution: Type.Optional(Type.Union([
          Type.Literal("keep_newer"),
          Type.Literal("keep_older"),
          Type.Literal("merge"),
          Type.Literal("dismiss")
        ], { description: "Resolution strategy. Required for resolve action." })),
        limit: Type.Optional(Type.Number({ default: 10, description: "Max conflicts to return for list action (default 10).", minimum: 1, maximum: 100 }))
      })
    },
    options: { name: "memory_conflicts" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("memory_conflicts requires cloud backend");
      const action = params.action;
      if (action === "list") {
        const limit = params.limit ?? 10;
        const conflicts = await sulcusMem.list_conflicts(namespace, limit);
        const summary = conflicts.length === 0 ? "No conflicts found." : `${conflicts.length} conflict(s) found.`;
        return {
          content: [{ type: "text", text: summary + "\n" + JSON.stringify(conflicts, null, 2) }],
          details: { action, count: conflicts.length, backend: backendMode, namespace }
        };
      } else {
        const conflictId = params.id;
        const resolution = params.resolution;
        if (!conflictId) return { content: [{ type: "text", text: "id is required for resolve action." }] };
        if (!resolution) return { content: [{ type: "text", text: "resolution is required for resolve action." }] };
        const res = await sulcusMem.resolve_conflict(conflictId, resolution);
        return {
          content: [{ type: "text", text: `Conflict ${conflictId} resolved with strategy: ${resolution}` }],
          details: { action, id: conflictId, resolution, result: res, backend: backendMode, namespace }
        };
      }
    }
  },
  core_memory_read: {
    schema: {
      name: "core_memory_read",
      label: "Core Memory Read",
      description: "Read the current core memory block \u2014 the persistent structured identity context always injected into agent sessions. Contains identity, relationships, preferences, current_focus, and custom fields.",
      parameters: Type.Object({})
    },
    options: { name: "core_memory_read" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, _params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("core_memory_read requires cloud backend");
      const core = await sulcusMem.get_core_memory();
      if (!core || Object.keys(core).length === 0) {
        return {
          content: [{ type: "text", text: "No core memory set. Use core_memory_update to create your identity block." }],
          details: { backend: backendMode, namespace }
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(core, null, 2) }],
        details: { backend: backendMode, namespace, fields: Object.keys(core) }
      };
    }
  },
  core_memory_update: {
    schema: {
      name: "core_memory_update",
      label: "Core Memory Update",
      description: "Update fields in the core memory block. Core memory is a persistent structured identity context always injected into agent sessions. Only provide the fields you want to update.",
      parameters: Type.Object({
        identity: Type.Optional(Type.String({ description: "Who the agent is: name, role, and description." })),
        relationships: Type.Optional(Type.String({ description: "Key people and entities the agent works with." })),
        preferences: Type.Optional(Type.String({ description: "Agent preferences and communication style." })),
        current_focus: Type.Optional(Type.String({ description: "What the agent is currently working on (mutable)." })),
        custom: Type.Optional(Type.String({ description: "JSON string of additional freeform key-value pairs." }))
      })
    },
    options: { name: "core_memory_update" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("core_memory_update requires cloud backend");
      const updates = {};
      if (typeof params.identity === "string" && params.identity.trim()) updates.identity = params.identity.trim();
      if (typeof params.relationships === "string" && params.relationships.trim()) updates.relationships = params.relationships.trim();
      if (typeof params.preferences === "string" && params.preferences.trim()) updates.preferences = params.preferences.trim();
      if (typeof params.current_focus === "string" && params.current_focus.trim()) updates.current_focus = params.current_focus.trim();
      if (typeof params.custom === "string" && params.custom.trim()) {
        try {
          updates.custom = JSON.parse(params.custom.trim());
        } catch {
          return { content: [{ type: "text", text: "Invalid JSON in custom field." }] };
        }
      }
      if (Object.keys(updates).length === 0) {
        return { content: [{ type: "text", text: "No fields provided to update." }] };
      }
      const res = await sulcusMem.update_core_memory(updates);
      coreMemoryCache = void 0;
      return {
        content: [{ type: "text", text: `Core memory updated. Fields changed: ${Object.keys(updates).join(", ")}` }],
        details: { updated: Object.keys(updates), result: res, backend: backendMode, namespace }
      };
    }
  },
  memory_archive: {
    schema: {
      name: "memory_archive",
      label: "Memory Archive",
      description: "List archived memories or restore specific ones from the archive.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("restore")], { description: "Action: 'list' to browse archived memories, 'restore' to un-archive specific ones." }),
        ids: Type.Optional(Type.Array(Type.String(), { description: "Memory UUIDs to restore. Required for restore action." })),
        limit: Type.Optional(Type.Number({ default: 20, description: "Max archived memories to return for list action (default 20).", minimum: 1, maximum: 100 })),
        offset: Type.Optional(Type.Number({ default: 0, description: "Pagination offset for list action (default 0).", minimum: 0 }))
      })
    },
    options: { name: "memory_archive" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("memory_archive requires cloud backend");
      const action = params.action;
      if (action === "list") {
        const limit = params.limit ?? 20;
        const offset = params.offset ?? 0;
        const res = await sulcusMem.list_archived(namespace, limit, offset);
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
          details: { action, limit, offset, backend: backendMode, namespace }
        };
      } else {
        const ids = params.ids;
        if (!ids || ids.length === 0) return { content: [{ type: "text", text: "ids array is required for restore action." }] };
        const res = await sulcusMem.restore_memories(ids, namespace);
        return {
          content: [{ type: "text", text: `Restored ${ids.length} memory(ies) from archive.` }],
          details: { action, ids, result: res, backend: backendMode, namespace }
        };
      }
    }
  },
  memory_fold: {
    schema: {
      name: "memory_fold",
      label: "Memory Fold",
      description: "Merge multiple related memories into a single consolidated node. Collapses redundant or tightly related memories into one.",
      parameters: Type.Object({
        ids: Type.Array(Type.String(), { description: "Array of memory UUIDs to merge (minimum 2).", minItems: 2 }),
        label: Type.Optional(Type.String({ description: "Optional summary label for the merged memory node." }))
      })
    },
    options: { name: "memory_fold" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("memory_fold requires cloud backend");
      const ids = params.ids;
      if (!ids || ids.length < 2) return { content: [{ type: "text", text: "At least 2 memory IDs are required to fold." }] };
      const label = params.label;
      const res = await sulcusMem.fold_memories(ids, namespace, label);
      return {
        content: [{ type: "text", text: `Folded ${ids.length} memories into one node.${label ? ` Label: "${label}"` : ""}` }],
        details: { ids, label, result: res, backend: backendMode, namespace }
      };
    }
  },
  memory_dashboard: {
    schema: {
      name: "memory_dashboard",
      label: "Memory Dashboard",
      description: "Get a high-level dashboard of memory health, usage statistics, and storage information.",
      parameters: Type.Object({})
    },
    options: { name: "memory_dashboard" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, _params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("memory_dashboard requires cloud backend");
      const [dashResult, storageResult] = await Promise.allSettled([
        sulcusMem.dashboard_stats(),
        sulcusMem.storage_status()
      ]);
      const dashboard = dashResult.status === "fulfilled" ? dashResult.value : {};
      const storage = storageResult.status === "fulfilled" ? storageResult.value : {};
      const merged = { ...dashboard, storage, backend: backendMode, namespace };
      return {
        content: [{ type: "text", text: JSON.stringify(merged, null, 2) }],
        details: merged
      };
    }
  },
  // -- Phase 4: Episodic Session Recall ---------------------------------------
  episode_recall: {
    schema: {
      name: "episode_recall",
      label: "Episode Recall",
      description: "Search past conversation episodes \u2014 structured session summaries including topic, decisions, files modified, and outcome. Use for questions like 'what did we discuss last time?' or 'when did we work on X?'",
      parameters: Type.Object({
        query: Type.String({ description: "Search query \u2014 topic, keyword, date, or question about past sessions." }),
        limit: Type.Optional(Type.Number({ default: 5, minimum: 1, maximum: 20, description: "Max episodes to return." }))
      })
    },
    options: { name: "episode_recall" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("episode_recall requires cloud backend");
      const query = params.query;
      const limit = Math.min(20, Math.max(1, params.limit ?? 5));
      const res = await sulcusMem.search_memory(`session episode: ${query}`, limit * 2, namespace);
      const episodes = (res?.results ?? []).filter((r) => {
        const mtype = r.memory_type;
        const content = (r.label ?? r.pointer_summary ?? "").toLowerCase();
        return mtype === "episodic" || content.includes("session episode") || content.includes("session compaction");
      }).slice(0, limit);
      if (episodes.length === 0) {
        return { content: [{ type: "text", text: `No episodes found matching "${query}".` }], details: { query, count: 0 } };
      }
      const formatted = episodes.map((e, i) => {
        const content = e.label ?? e.pointer_summary ?? e.content ?? "";
        const heat = typeof e.current_heat === "number" ? e.current_heat.toFixed(2) : "?";
        const date = e.updated_at ?? e.created_at ?? "unknown";
        const meta = e.metadata;
        let metaStr = "";
        if (meta) {
          const parts = [];
          if (meta.mood) parts.push(`Mood: ${meta.mood}`);
          if (meta.outcome) parts.push(`Outcome: ${meta.outcome}`);
          if (meta.duration_turns) parts.push(`Turns: ${meta.duration_turns}`);
          if (parts.length > 0) metaStr = ` [${parts.join(", ")}]`;
        }
        return `${i + 1}. [${date}] (heat: ${heat})${metaStr}
   ${content}`;
      }).join("\n\n");
      return {
        content: [{ type: "text", text: `Found ${episodes.length} episode(s) for "${query}":

${formatted}` }],
        details: { query, count: episodes.length, backend: backendMode, namespace }
      };
    }
  },
  memory_namespace: {
    schema: {
      name: "memory_namespace",
      label: "Memory Namespace",
      description: "Switch the active memory namespace at runtime. Useful for reading from project-specific or shared namespaces, or when serving multiple users. Affects all subsequent memory operations until switched again or the session ends.",
      parameters: Type.Object({
        namespace: Type.String({ description: "Target namespace to switch to. Use the base namespace name (e.g. 'ariadne', 'project-alpha')." }),
        reason: Type.Optional(Type.String({ description: "Why you're switching namespace \u2014 logged for audit trail." }))
      })
    },
    options: { name: "memory_namespace" },
    makeExecute: ({ backendMode, namespace: currentNs, logger }) => async (_id, params) => {
      const target = params.namespace.trim();
      if (!target) return { content: [{ type: "text", text: "Namespace cannot be empty." }] };
      const reason = params.reason ?? "manual switch";
      activeNamespaceOverride = target;
      logger.info(`sulcus: namespace switched ${currentNs} \u2192 ${target} (reason: ${reason})`);
      return {
        content: [{ type: "text", text: `Namespace switched: **${currentNs}** \u2192 **${target}**
Reason: ${reason}

All subsequent memory operations will use namespace \`${target}\` until switched again or session ends.` }],
        details: { previous: currentNs, current: target, reason, backend: backendMode }
      };
    }
  },
  namespace_list: {
    schema: {
      name: "namespace_list",
      label: "Namespace List",
      description: "List available memory namespaces and their stats (node count, last activity). Useful for multi-user setups or project-scoped memory. Cloud-only.",
      parameters: Type.Object({})
    },
    options: { name: "namespace_list" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable }) => async (_id, _params) => {
      if (!isAvailable || !sulcusMem) throw new Error(`Sulcus unavailable: ${nativeLoader.error || "not loaded"}`);
      if (!(sulcusMem instanceof SulcusCloudClient)) throw new Error("namespace_list requires cloud backend");
      try {
        const res = await sulcusMem.list_namespaces();
        if (!res || !Array.isArray(res) || res.length === 0) {
          return { content: [{ type: "text", text: "No namespaces found or endpoint not available." }] };
        }
        const current = activeNamespaceOverride ?? namespace;
        const formatted = res.map((ns) => {
          const name = ns.namespace ?? ns.name ?? "unknown";
          const count = ns.node_count ?? ns.count ?? "?";
          const active = name === current ? " \u2190 active" : "";
          return `- **${name}** (${count} nodes)${active}`;
        }).join("\n");
        return {
          content: [{ type: "text", text: `## Namespaces
Active: \`${current}\`

${formatted}` }],
          details: { namespaces: res, active: current, backend: backendMode }
        };
      } catch {
        return { content: [{ type: "text", text: "Namespace listing not available \u2014 server may need update." }] };
      }
    }
  },
  sulcus_setup: {
    schema: {
      name: "sulcus_setup",
      label: "Sulcus Setup",
      description: "Run the Sulcus setup diagnostic \u2014 checks backend connectivity, configuration status, core memory state, and generates recommended cron job configurations for memory maintenance. Call this once when first setting up Sulcus.",
      parameters: Type.Object({
        init_core_memory: Type.Optional(Type.Boolean({ description: "If true and core memory is empty, initialize it with defaults based on the agent's namespace." }))
      })
    },
    options: { name: "sulcus_setup" },
    makeExecute: ({ sulcusMem, backendMode, namespace, nativeLoader, isAvailable, logger }) => async (_id, params) => {
      const report = [];
      report.push("# \u{1F9F5} Sulcus Setup Report\n");
      report.push("## Backend");
      if (!isAvailable || !sulcusMem) {
        report.push(`\u274C **Not available** \u2014 ${nativeLoader.error || "not loaded"}`);
        report.push("Fix: Check your sulcus config (apiKey, server URL). Run `memory_status` for details.\n");
        return { content: [{ type: "text", text: report.join("\n") }], details: { status: "unavailable" } };
      }
      report.push(`\u2705 **Backend:** ${backendMode}`);
      report.push(`\u2705 **Namespace:** ${namespace || "(default)"}`);
      const isCloud = sulcusMem instanceof SulcusCloudClient;
      if (isCloud) {
        try {
          const info = await sulcusMem.request("GET", "/api/v1/agent/info");
          if (info) {
            report.push(`\u2705 **Server:** connected`);
            if (info.capabilities) report.push(`   Capabilities: ${JSON.stringify(info.capabilities)}`);
          }
        } catch {
          report.push("\u26A0\uFE0F **Server info:** could not fetch (non-critical)");
        }
      }
      report.push("");
      report.push("## Configuration");
      const checks = [
        ["Auto-recall (before_prompt_build)", true, "Memories are injected into context automatically"],
        ["Auto-capture (agent_end)", true, "Conversations are captured when sessions end"],
        ["Context-window awareness", true, "Plugin self-throttles to prevent context overflow"],
        ["Cloud backend", isCloud, "Required for advanced tools (graph, conflicts, archive, fold, dashboard, core memory, episodes)"]
      ];
      for (const [name, ok, desc] of checks) {
        report.push(`${ok ? "\u2705" : "\u26A0\uFE0F"} **${name}** \u2014 ${desc}`);
      }
      report.push("");
      report.push("## Core Memory");
      if (isCloud) {
        try {
          const core = await sulcusMem.get_core_memory();
          if (core && Object.keys(core).filter((k) => !["namespace", "created_at", "updated_at"].includes(k)).length > 0) {
            const fields = Object.keys(core).filter((k) => !["namespace", "created_at", "updated_at"].includes(k));
            report.push(`\u2705 **Core memory set** \u2014 fields: ${fields.join(", ")}`);
          } else {
            report.push("\u26A0\uFE0F **Core memory is empty** \u2014 no persistent identity block");
            if (params.init_core_memory) {
              try {
                await sulcusMem.update_core_memory({
                  identity: `Agent in namespace '${namespace || "default"}'`,
                  current_focus: "Initial setup"
                });
                report.push("\u2705 **Initialized** with default identity. Use `core_memory_update` to customize.");
                coreMemoryCache = void 0;
              } catch (e) {
                report.push(`\u274C **Init failed:** ${e instanceof Error ? e.message : String(e)}`);
              }
            } else {
              report.push("   \u2192 Call `sulcus_setup(init_core_memory: true)` to initialize, or use `core_memory_update` directly.");
            }
          }
        } catch {
          report.push("\u26A0\uFE0F **Core memory endpoint not available** \u2014 server may need update");
        }
      } else {
        report.push("\u26A0\uFE0F Core memory requires cloud backend");
      }
      report.push("");
      report.push("## Available Tools");
      const allTools = [
        ["memory_store", "Store memories"],
        ["memory_recall", "Search memories"],
        ["memory_get", "Fetch by ID (cloud)"],
        ["memory_list", "Browse memories (cloud)"],
        ["memory_update", "Update in-place (cloud)"],
        ["memory_delete", "Delete memories"],
        ["memory_status", "Backend status"],
        ["memory_profile", "Health snapshot"],
        ["memory_namespace", "Switch namespace"],
        ["core_memory_read", "Read identity block (cloud)"],
        ["core_memory_update", "Update identity block (cloud)"],
        ["graph_explore", "Knowledge graph traversal (cloud)"],
        ["memory_conflicts", "Conflict detection (cloud)"],
        ["memory_archive", "Archive management (cloud)"],
        ["memory_fold", "Memory consolidation (cloud)"],
        ["memory_dashboard", "Health dashboard (cloud)"],
        ["episode_recall", "Past session search (cloud)"],
        ["namespace_list", "List namespaces (cloud)"],
        ["session_store", "Session-scoped storage"],
        ["session_recall", "Session-scoped search"],
        ["consolidate", "Trigger consolidation"],
        ["guardrail_status", "Safety guardrails"],
        ["sulcus_setup", "This tool"]
      ];
      const cloudOnly = ["memory_get", "memory_list", "memory_update", "core_memory_read", "core_memory_update", "graph_explore", "memory_conflicts", "memory_archive", "memory_fold", "memory_dashboard", "episode_recall", "namespace_list"];
      let available = 0;
      for (const [name, desc] of allTools) {
        const ok = cloudOnly.includes(name) ? isCloud : true;
        if (ok) available++;
        report.push(`${ok ? "\u2705" : "\u26A0\uFE0F"} \`${name}\` \u2014 ${desc}`);
      }
      report.push(`
**${available}/${allTools.length}** tools available.
`);
      report.push("## Recommended Maintenance Crons");
      report.push("");
      report.push("Set these up in your host platform (OpenClaw cron, system crontab, etc.):");
      report.push("");
      report.push("### 1. Daily Consolidation");
      report.push("Merge related memories, reduce noise, strengthen connections.");
      report.push("```");
      report.push("Schedule: daily at 03:00 UTC");
      report.push("Action: Call consolidate(min_heat: 0.1)");
      report.push("OpenClaw cron example:");
      report.push('  schedule: { kind: "cron", expr: "0 3 * * *", tz: "UTC" }');
      report.push('  payload: { kind: "agentTurn", message: "Run consolidate(min_heat: 0.1) and report results." }');
      report.push("```");
      report.push("");
      report.push("### 2. Weekly Quality Audit");
      report.push("Check memory health, identify duplicates, review type distribution.");
      report.push("```");
      report.push("Schedule: weekly on Sunday at 04:00 UTC");
      report.push("Action: Call memory_dashboard() and memory_profile()");
      report.push("OpenClaw cron example:");
      report.push('  schedule: { kind: "cron", expr: "0 4 * * 0", tz: "UTC" }');
      report.push('  payload: { kind: "agentTurn", message: "Run memory_dashboard() and memory_profile(). Summarize health and flag issues." }');
      report.push("```");
      report.push("");
      report.push("### 3. Daily Dashboard Snapshot");
      report.push("Quick health check \u2014 storage, node counts, hot memories.");
      report.push("```");
      report.push("Schedule: daily at 08:00 local");
      report.push("Action: Call memory_status()");
      report.push("OpenClaw cron example:");
      report.push('  schedule: { kind: "cron", expr: "0 8 * * *", tz: "America/Vancouver" }');
      report.push('  payload: { kind: "agentTurn", message: "Run memory_status() and report any anomalies." }');
      report.push("```");
      report.push("");
      report.push("---");
      report.push("*Setup complete. Run this tool again anytime to re-check status.*");
      return {
        content: [{ type: "text", text: report.join("\n") }],
        details: {
          status: "ok",
          backend: backendMode,
          namespace,
          isCloud,
          toolsAvailable: available,
          toolsTotal: allTools.length,
          coreMemorySet: true
        }
      };
    }
  }
};
async function importOpenClawHistory(sulcusMem, logger) {
  const fs = require("fs");
  const path = require("path");
  const workspaceDir = process.env.OPENCLAW_WORKSPACE ? (0, import_node_path.resolve)(process.env.OPENCLAW_WORKSPACE) : (0, import_node_path.resolve)(process.env.HOME || "~", ".openclaw/workspace");
  const markerPath = path.join(workspaceDir, ".sulcus-imported");
  if (fs.existsSync(markerPath)) return;
  logger.info("sulcus: first-install history import starting...");
  const memories = [];
  const memoryMdPath = path.join(workspaceDir, "MEMORY.md");
  if (fs.existsSync(memoryMdPath)) {
    try {
      const text = fs.readFileSync(memoryMdPath, "utf-8");
      const entries = text.split(/\n(?:---+|\s*\n\s*\n)/g).map((s) => s.trim()).filter((s) => s.length > 20);
      memories.push(...entries);
    } catch (_e) {
    }
  }
  const memDir = path.join(workspaceDir, "memory");
  if (fs.existsSync(memDir)) {
    try {
      const files = fs.readdirSync(memDir);
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1e3;
      for (const file of files) {
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) continue;
        try {
          const stat = fs.statSync(path.join(memDir, file));
          if (now - stat.mtimeMs > thirtyDaysMs) continue;
          const text = fs.readFileSync(path.join(memDir, file), "utf-8");
          const entries = text.split(/\n---\n/g).map((s) => s.trim()).filter((s) => s.length > 20);
          memories.push(...entries);
        } catch (_e) {
        }
      }
    } catch (_e) {
    }
  }
  let stored = 0;
  for (const mem of memories) {
    try {
      await sulcusMem.add_memory(mem, "episodic");
      stored++;
    } catch (_e) {
    }
  }
  try {
    fs.writeFileSync(markerPath, (/* @__PURE__ */ new Date()).toISOString(), "utf-8");
    logger.info(`sulcus: history import complete \u2014 stored ${stored} memories from OpenClaw workspace`);
  } catch (_e) {
  }
}
var sulcusPlugin = {
  id: "openclaw-sulcus",
  name: "Sulcus vMMU",
  description: "Sulcus-backed vMMU memory for OpenClaw \u2014 thermodynamic decay, reactive triggers, local-first",
  kind: "memory",
  register(api) {
    const logger = api.logger;
    const rawPluginConfig = api.pluginConfig ?? {};
    const tomlConfigPath = rawPluginConfig?.configFile;
    const tomlConfig = loadSulcusToml(tomlConfigPath, logger);
    const pluginConfig = mergeConfig(tomlConfig, rawPluginConfig);
    const libDir = pluginConfig?.libDir ? (0, import_node_path.resolve)(pluginConfig.libDir) : (0, import_node_path.resolve)(process.env.HOME || "~", ".sulcus/lib");
    const dataDir = (0, import_node_path.resolve)(process.env.HOME || "~", ".sulcus/data");
    for (const dir of [libDir, dataDir]) {
      if (!(0, import_node_fs.existsSync)(dir)) {
        try {
          (0, import_node_fs.mkdirSync)(dir, { recursive: true });
          logger.info(`sulcus: created directory ${dir}`);
        } catch {
        }
      }
    }
    const storeLibPath = pluginConfig?.storeLibPath ? (0, import_node_path.resolve)(pluginConfig.storeLibPath) : (0, import_node_path.resolve)(libDir, process.platform === "darwin" ? "libsulcus_store.dylib" : "libsulcus_store.so");
    const vectorsLibPath = pluginConfig?.vectorsLibPath ? (0, import_node_path.resolve)(pluginConfig.vectorsLibPath) : (0, import_node_path.resolve)(libDir, process.platform === "darwin" ? "libsulcus_vectors.dylib" : "libsulcus_vectors.so");
    const wasmDir = pluginConfig?.wasmDir ? (0, import_node_path.resolve)(pluginConfig.wasmDir) : (0, import_node_path.resolve)(__dirname, "wasm");
    const serverUrl = pluginConfig?.serverUrl;
    const apiKey = pluginConfig?.apiKey;
    const agentId = pluginConfig?.agentId;
    const namespace = pluginConfig?.namespace === "default" && agentId ? agentId : pluginConfig?.namespace || agentId || "default";
    const autoRecall = pluginConfig?.autoRecall ?? false;
    const autoCapture = pluginConfig?.autoCapture ?? false;
    const maxRecallResults = Math.min(20, Math.max(1, pluginConfig?.maxRecallResults ?? 5));
    const profileFrequency = Math.min(500, Math.max(1, pluginConfig?.profileFrequency ?? 10));
    const rawMaxRecallChars = pluginConfig?.maxRecallChars;
    const tokenBudgetFromChars = rawMaxRecallChars ? Math.floor(rawMaxRecallChars / 4) : void 0;
    const tokenBudget = Math.min(16e3, Math.max(100, tokenBudgetFromChars ?? pluginConfig?.tokenBudget ?? 1e4));
    const contextWindowSize = Math.max(8e3, pluginConfig?.contextWindowSize ?? 2e5);
    const boostOnRecallEnabled = pluginConfig?.boostOnRecall ?? true;
    const captureFromAssistant = pluginConfig?.captureFromAssistant ?? false;
    const contextRebuildEnabled = pluginConfig?.contextRebuild?.enabled !== false;
    const contextRebuildBudget = Math.min(16e3, Math.max(500, pluginConfig?.contextRebuild?.tokenBudget ?? 1e4));
    const hooksConfig = loadHooksConfig(pluginConfig);
    let sulcusMem = null;
    let backendMode = "unavailable";
    if (serverUrl && apiKey) {
      try {
        sulcusMem = new SulcusCloudClient(serverUrl, apiKey);
        backendMode = "cloud";
        logger.info(`sulcus: using cloud backend (server: ${serverUrl})`);
      } catch (e) {
        logger.warn(`sulcus: cloud client init failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    const nativeLoader = new NativeLibLoader(storeLibPath, vectorsLibPath);
    if (sulcusMem === null && !(serverUrl && apiKey)) {
      nativeLoader.init(logger);
      if (nativeLoader.loaded) {
        const wasmJsPath = (0, import_node_path.resolve)(wasmDir, "sulcus_wasm.js");
        if ((0, import_node_fs.existsSync)(wasmJsPath)) {
          try {
            const { SulcusMem, on_init } = require(wasmJsPath);
            if (typeof on_init === "function") on_init();
            sulcusMem = SulcusMem.create(nativeLoader.makeQueryFn(), nativeLoader.makeEmbedFn());
            backendMode = "wasm";
            logger.info(`sulcus: SulcusMem created via WASM (wasm: ${wasmJsPath})`);
          } catch (e) {
            logger.warn(`sulcus: WASM load failed: ${e instanceof Error ? e.message : e}`);
          }
        } else {
          logger.warn(`sulcus: WASM module not found at ${wasmJsPath}`);
        }
      } else {
        logger.info(`sulcus: local mode skipped \u2014 ${nativeLoader.error || "dylibs not found"}`);
      }
    }
    const isAvailable = sulcusMem !== null;
    const isCloudBackend = backendMode === "cloud" && sulcusMem instanceof SulcusCloudClient;
    STATIC_AWARENESS = buildStaticAwareness(backendMode, namespace);
    REBUILD_TOKEN_BUDGET = contextRebuildBudget;
    if (isAvailable) {
      logger.info(`sulcus: ready \u2705 (backend: ${backendMode}, namespace: ${namespace}, autoRecall: ${autoRecall}, autoCapture: ${autoCapture}, captureFromAssistant: ${captureFromAssistant}, contextRebuild: ${contextRebuildEnabled})`);
    } else {
      const hints = [];
      if (!serverUrl && !apiKey) {
        hints.push("To use Sulcus cloud: set serverUrl and apiKey in plugin config");
        hints.push("Get an API key at https://sulcus.ca/dashboard/settings");
      } else if (serverUrl && !apiKey) {
        hints.push("serverUrl is set but apiKey is missing \u2014 add your API key to plugin config");
      } else if (!serverUrl && apiKey) {
        hints.push("apiKey is set but serverUrl is missing \u2014 add serverUrl (e.g. https://api.sulcus.ca)");
      } else {
        hints.push("Cloud connection failed \u2014 check serverUrl and apiKey are correct");
      }
      if (!serverUrl && !apiKey && nativeLoader.error) {
        hints.push(`Local mode: ${nativeLoader.error}`);
      }
      logger.warn(`sulcus: not ready \u2014 ${hints.join(". ")}`);
    }
    const siuRequestFn = isCloudBackend && sulcusMem ? (method, path, body) => sulcusMem.request(method, path, body) : null;
    const toolDeps = {
      sulcusMem,
      backendMode,
      namespace,
      nativeLoader,
      storeLibPath,
      vectorsLibPath,
      wasmDir,
      logger,
      isAvailable,
      siuRequest: siuRequestFn
    };
    const handlerCtx = {
      sulcusMem,
      backendMode,
      namespace,
      logger,
      nativeError: nativeLoader.error,
      storeLibPath,
      vectorsLibPath,
      wasmDir,
      boostOnRecall: boostOnRecallEnabled,
      profileFrequency,
      tokenBudget,
      contextWindowSize
    };
    if (isCloudBackend && sulcusMem && typeof api.registerMemoryRuntime === "function") {
      try {
        api.registerMemoryRuntime(buildMemoryRuntime(sulcusMem, backendMode));
        logger.info("sulcus: registered as memory runtime (MemoryPluginRuntime)");
      } catch (e) {
        logger.warn(`sulcus: registerMemoryRuntime failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (typeof api.registerMemoryPromptSection === "function") {
      try {
        api.registerMemoryPromptSection(buildPromptSection);
        logger.info("sulcus: registered memory prompt section");
      } catch (e) {
        logger.warn(`sulcus: registerMemoryPromptSection failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (typeof api.registerMemoryFlushPlan === "function") {
      try {
        api.registerMemoryFlushPlan(() => {
          if (!isAvailable || !sulcusMem) return null;
          return {
            softThresholdTokens: 15e3,
            forceFlushTranscriptBytes: "2mb",
            reserveTokensFloor: 3e4,
            prompt: [
              "Your session is approaching context limits. Before compaction, extract and save the most important information from this conversation using memory_store.",
              "",
              "Focus on:",
              "- Decisions made and their reasoning",
              "- Facts learned or confirmed",
              "- User preferences stated or implied",
              "- Procedures or workflows discussed",
              "- Errors encountered and their resolutions",
              "",
              "Use the appropriate memory_type for each:",
              "- preference: user preferences, opinions, style choices",
              "- fact: data points, configurations, names, values",
              "- semantic: knowledge, explanations, conclusions",
              "- procedural: how-tos, workflows, step-by-step processes",
              "- episodic: events, conversations, time-specific context",
              "",
              "Store 3-8 memories. Be selective \u2014 quality over quantity. Skip trivial exchanges."
            ].join("\n"),
            systemPrompt: "You are a memory extraction agent. Your job is to identify and store the most valuable information from the current conversation before it gets compacted. Use memory_store with precise memory_type classification. Do not store system noise, tool outputs, or trivial exchanges."
          };
        });
        logger.info("sulcus: registered memory flush plan (Sulcus-aware)");
      } catch (e) {
        logger.warn(`sulcus: registerMemoryFlushPlan failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (isCloudBackend && sulcusMem && typeof api.registerCompactionProvider === "function") {
      try {
        const compactionSulcusMem = sulcusMem;
        api.registerCompactionProvider({
          id: "sulcus",
          async summarize(params) {
            const msgs = params.messages ?? [];
            logger.info(`sulcus: compaction provider summarize() called with ${msgs.length} messages`);
            try {
              const decisions = [];
              const filesModified = [];
              const toolsUsed = [];
              const errorsHit = [];
              const userIntents = [];
              const assistantWork = [];
              const DECISION_MARKERS = ["decided", "will use", "going to", "plan is", "the fix", "conclusion", "recommend", "approach"];
              for (const msg of msgs) {
                const role = msg.role ?? msg.type;
                const text = typeof msg.content === "string" ? msg.content : typeof msg.text === "string" ? msg.text : Array.isArray(msg.content) ? msg.content.filter((c) => c.type === "text").map((c) => c.text).join("\n") : "";
                if (!text) continue;
                if ((role === "user" || role === "human") && text.length > 10) {
                  userIntents.push(text.substring(0, 200));
                }
                if ((role === "assistant" || role === "ai") && text.length > 50) {
                  const lc = text.toLowerCase();
                  if (DECISION_MARKERS.some((m) => lc.includes(m))) {
                    const sentences = text.split(/[.!?\n]/).filter((s) => s.trim().length > 15);
                    for (const s of sentences) {
                      if (DECISION_MARKERS.some((m) => s.toLowerCase().includes(m))) {
                        decisions.push(s.trim().substring(0, 300));
                        if (decisions.length >= 8) break;
                      }
                    }
                  }
                  if (text.length > 100) {
                    assistantWork.push(text.substring(0, 500));
                  }
                }
                const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
                for (const tc of toolCalls) {
                  const name = tc.name ?? tc.function ?? "";
                  if (name && !toolsUsed.includes(name)) toolsUsed.push(name);
                  if (/^(write|edit)$/i.test(name)) {
                    const input = tc.input ?? tc.arguments ?? {};
                    const fp = input?.file_path ?? input?.path;
                    if (fp && !filesModified.includes(fp)) filesModified.push(fp);
                  }
                }
                if (role === "tool" && (msg.is_error === true || typeof text === "string" && /error|failed|exception/i.test(text.substring(0, 100)))) {
                  errorsHit.push(text.substring(0, 200));
                }
              }
              let stored = 0;
              const itemsToStore = [];
              for (const d of decisions.slice(0, 5)) {
                itemsToStore.push({ text: d, suggestedType: "semantic" });
              }
              for (const u of userIntents.slice(0, 5)) {
                if (u.length > 50 && /\b(prefer|always|never|don't|stop|use|switch|remember)\b/i.test(u)) {
                  itemsToStore.push({ text: u, suggestedType: "preference" });
                }
              }
              for (const a of assistantWork.slice(0, 3)) {
                if (/\b(step \d|procedure|workflow|how to|instructions)\b/i.test(a)) {
                  itemsToStore.push({ text: a, suggestedType: "procedural" });
                } else {
                  itemsToStore.push({ text: a, suggestedType: "semantic" });
                }
              }
              for (const item of itemsToStore) {
                if (isJunkMemory(item.text)) continue;
                if (!shouldCapture(item.text)) continue;
                try {
                  let memType = item.suggestedType;
                  try {
                    const siuResult = await compactionSulcusMem.request(
                      "POST",
                      "/api/v2/siu/label",
                      { text: item.text }
                    );
                    if (siuResult?.store === false && (siuResult?.store_confidence ?? 0) < 0.3) continue;
                    if (siuResult?.memory_type) memType = siuResult.memory_type;
                  } catch {
                  }
                  const hints = buildExtractionHints(memType, namespace, "compaction_provider", item.text.substring(0, 200));
                  await compactionSulcusMem.add_memory(item.text, memType, hints);
                  stored++;
                } catch {
                }
              }
              logger.info(`sulcus: compaction provider \u2014 stored ${stored} memories`);
              const topicQuery = userIntents.slice(0, 3).join(" ").substring(0, 500) || "session summary";
              let relevantMemories = [];
              try {
                const searchRes = await compactionSulcusMem.search_memory(topicQuery, 15, namespace);
                relevantMemories = searchRes?.results ?? [];
              } catch (e) {
                logger.warn(`sulcus: compaction provider \u2014 memory search failed: ${e}`);
              }
              const sections = [];
              if (params.previousSummary?.trim()) {
                sections.push(`## Prior Context
${params.previousSummary.trim()}`);
              }
              const memLines = [];
              const seenIds = /* @__PURE__ */ new Set();
              for (const mem of relevantMemories) {
                const id = mem.id;
                if (seenIds.has(id)) continue;
                seenIds.add(id);
                const mtype = mem.memory_type ?? "unknown";
                const label = (mem.label ?? mem.pointer_summary ?? "").trim();
                if (!label || label.length < 20) continue;
                memLines.push(`- [${mtype}] ${label.length > 400 ? label.substring(0, 400) + "..." : label}`);
              }
              if (memLines.length > 0) {
                sections.push(`## Key Context (from Sulcus memory)
${memLines.join("\n")}`);
              }
              if (decisions.length > 0) {
                sections.push(`## Decisions Made
${decisions.map((d) => "- " + d).join("\n")}`);
              }
              const activity = [`${msgs.length} messages in this session segment`];
              if (filesModified.length > 0) activity.push(`Files modified: ${filesModified.join(", ")}`);
              if (toolsUsed.length > 0) activity.push(`Tools used: ${toolsUsed.join(", ")}`);
              if (errorsHit.length > 0) activity.push(`Errors: ${errorsHit.length}`);
              sections.push(`## Session Activity
${activity.join("\n")}`);
              const summary = sections.join("\n\n");
              if (!summary.trim()) throw new Error("Sulcus compaction produced empty summary");
              logger.info(`sulcus: compaction provider produced summary (${summary.length} chars)`);
              return summary;
            } catch (err) {
              logger.warn(`sulcus: compaction provider failed: ${err instanceof Error ? err.message : String(err)}`);
              throw err;
            }
          }
        });
        logger.info('sulcus: registered compaction provider "sulcus"');
      } catch (e) {
        logger.warn(`sulcus: registerCompactionProvider failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (typeof api.registerService === "function") {
      try {
        api.registerService({
          id: "openclaw-sulcus",
          start: async (ctx) => {
            const svcLogger = ctx?.logger ?? logger;
            if (!isAvailable || !sulcusMem) {
              svcLogger.warn("sulcus: service start \u2014 backend unavailable, running in degraded mode");
              return;
            }
            if (isCloudBackend) {
              try {
                const ok = await sulcusMem.probe();
                if (ok) svcLogger.info(`sulcus: service started \u2014 cloud backend connected (${serverUrl}, namespace: ${namespace})`);
                else svcLogger.warn(`sulcus: service started \u2014 cloud backend unreachable (${serverUrl})`);
              } catch (e) {
                svcLogger.warn("sulcus: service start probe failed");
              }
            } else {
              svcLogger.info("sulcus: service started (backend: " + backendMode + ", namespace: " + namespace + ")");
            }
          },
          stop: async (ctx) => {
            const svcLogger = ctx?.logger ?? logger;
            svcLogger.info("sulcus: service stopped");
          }
        });
        logger.info("sulcus: registered service lifecycle");
      } catch (e) {
        logger.warn("sulcus: registerService failed: " + (e instanceof Error ? e.message : String(e)));
      }
    }
    if (isCloudBackend && sulcusMem) {
      if (autoRecall) {
        const sdkRecallHandler = buildSdkRecallHandler(
          sulcusMem,
          namespace,
          maxRecallResults,
          profileFrequency,
          logger,
          boostOnRecallEnabled,
          tokenBudget,
          contextRebuildEnabled,
          contextWindowSize
        );
        const apiOn = api.on;
        apiOn("before_prompt_build", async (event, ctx) => {
          try {
            const result = await sdkRecallHandler(event, ctx);
            if (!result) return { prependSystemContext: STATIC_AWARENESS };
            const r = result;
            if (r.prependContext) return { prependSystemContext: r.prependContext };
            return result;
          } catch (err) {
            logger.warn("sulcus: before_prompt_build recall hook threw: " + err);
            return { prependSystemContext: STATIC_AWARENESS };
          }
        });
        logger.info("sulcus: registered before_prompt_build (recall + awareness)");
      } else {
        const apiOn = api.on;
        apiOn("before_prompt_build", async (_event, _ctx) => {
          return { prependSystemContext: STATIC_AWARENESS };
        });
        logger.info("sulcus: registered before_prompt_build (awareness-only)");
      }
    }
    if (typeof api.registerMemoryEmbeddingProvider === "function" && isCloudBackend && sulcusMem) {
      try {
        api.registerMemoryEmbeddingProvider({
          id: "sulcus",
          label: "Sulcus (BGE-small-en-v1.5)",
          transport: "remote",
          autoSelectPriority: 50,
          embed: async (texts) => {
            let warned = false;
            const results = await Promise.all(
              texts.map(async (text) => {
                const res = await sulcusMem.embed_text(text, namespace);
                if (!res) {
                  if (!warned) {
                    warned = true;
                    logger.warn("sulcus: embed_text returned null \u2014 /api/v1/agent/embed not available on this server version; embedding provider will return empty vectors");
                  }
                  return [];
                }
                return res.embedding;
              })
            );
            return { embeddings: results, model: "bge-small-en-v1.5", dimensions: 384 };
          }
        });
        logger.info("sulcus: registered memory embedding provider (BGE-small-en-v1.5)");
      } catch (e) {
        logger.warn(`sulcus: registerMemoryEmbeddingProvider failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (autoCapture) {
      const agentEndCaptureConfig = {
        action: "sivu_auto_capture",
        enabled: true,
        // Task 25: Lowered from 0.5 → 0.4 — SIVU gate was too aggressive,
        // rejecting real architectural/technical content that scored in the
        // 0.4–0.5 range. 0.4 is still well above noise threshold (< 0.2).
        min_store_confidence: 0.4,
        fallback_on_error: true
      };
      const apiOn = api.on;
      apiOn("agent_end", async (event, _ctx) => {
        try {
          return await hookHandlers.sivu_auto_capture(event, agentEndCaptureConfig, handlerCtx);
        } catch (err) {
          logger.warn("sulcus: auto-capture hook threw: " + err);
          return void 0;
        }
      });
      logger.info("sulcus: registered auto-capture (agent_end)");
      if (isAvailable && sulcusMem instanceof SulcusCloudClient) {
        const episodeApiOn = api.on;
        episodeApiOn("agent_end", async (event) => {
          try {
            const messages = Array.isArray(event?.messages) ? event.messages : [];
            if (messages.length === 0) return;
            const firstUser = messages.find((m) => m.role === "user" || m.type === "human");
            const firstUserText = typeof firstUser?.content === "string" ? firstUser.content.substring(0, 200) : typeof firstUser?.text === "string" ? firstUser.text.substring(0, 200) : "(none)";
            const filesModified = [];
            const commandsRun = [];
            const decisions = [];
            const errors = [];
            const DECISION_MARKERS = ["decided", "will use", "going to", "plan is", "the fix", "conclusion", "recommend", "approach"];
            const ERROR_MARKERS = ["error:", "failed:", "exception", "traceback", "panicked", "stack trace"];
            for (const msg of messages) {
              const role = msg.role ?? msg.type;
              const rawContent = typeof msg.content === "string" ? msg.content : typeof msg.text === "string" ? msg.text : "";
              if ((role === "assistant" || role === "ai") && rawContent.length > 20) {
                const lc = rawContent.toLowerCase();
                if (DECISION_MARKERS.some((m) => lc.includes(m))) {
                  const sentences = rawContent.split(/[.!?\n]/).filter((s) => s.trim().length > 10);
                  for (const s of sentences) {
                    if (DECISION_MARKERS.some((m) => s.toLowerCase().includes(m)) && !decisions.includes(s.trim())) {
                      decisions.push(s.trim().substring(0, 200));
                      if (decisions.length >= 5) break;
                    }
                  }
                }
                const lcContent = rawContent.toLowerCase();
                if (ERROR_MARKERS.some((m) => lcContent.includes(m))) {
                  const errorLine = rawContent.split("\n").find((l) => ERROR_MARKERS.some((m) => l.toLowerCase().includes(m)));
                  if (errorLine && !errors.includes(errorLine.trim())) {
                    errors.push(errorLine.trim().substring(0, 150));
                  }
                }
              }
              const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
              for (const tc of toolCalls) {
                const name = tc.name ?? tc.function;
                if (name === "Write" || name === "Edit" || name === "write" || name === "edit") {
                  const input = tc.input ?? tc.arguments ?? {};
                  const fp = input?.file_path ?? input?.path;
                  if (fp && typeof fp === "string" && !filesModified.includes(fp)) filesModified.push(fp);
                }
                if (name === "Bash" || name === "bash" || name === "exec" || name === "shell") {
                  const input = tc.input ?? tc.arguments ?? {};
                  const cmd = input?.command ?? input?.cmd;
                  if (cmd && typeof cmd === "string" && commandsRun.length < 5) {
                    commandsRun.push(cmd.substring(0, 100));
                  }
                }
              }
            }
            const allText = messages.map((m) => {
              const content = typeof m.content === "string" ? m.content : typeof m.text === "string" ? m.text : "";
              return content.toLowerCase();
            }).join(" ");
            const episode = {
              topic: firstUserText,
              decisions: decisions.slice(0, 5),
              files_modified: filesModified.slice(0, 10),
              commands_run: commandsRun.slice(0, 5),
              errors: errors.slice(0, 3),
              outcome: "completed",
              duration_turns: messages.length,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            };
            if (allText.includes("error") || allText.includes("failed") || allText.includes("broken")) {
              episode.mood = "debugging";
            } else if (allText.includes("looks good") || allText.includes("working") || allText.includes("done")) {
              episode.mood = "productive";
            } else if (allText.includes("?") && allText.split("?").length > 3) {
              episode.mood = "exploratory";
            } else {
              episode.mood = "neutral";
            }
            await sulcusMem.store_episode(episode).then(
              (res) => logger.info(`sulcus: agent_end \u2014 stored structured episode (id: ${res?.id ?? "?"})`)
            ).catch((e) => logger.debug?.(`sulcus: agent_end \u2014 episode store failed: ${e instanceof Error ? e.message : String(e)}`));
          } catch (err) {
            logger.debug?.("sulcus: agent_end episode capture threw: " + err);
          }
        });
        logger.info("sulcus: registered agent_end episode capture (Phase 4)");
      }
    }
    if (isAvailable && sulcusMem instanceof SulcusCloudClient) {
      const sessionPurgeApiOn = api.on;
      sessionPurgeApiOn("agent_end", async () => {
        activeNamespaceOverride = null;
        if (sessionMemoryIds.size === 0) return;
        const ids = Array.from(sessionMemoryIds);
        sessionMemoryIds.clear();
        logger.info(`sulcus: session_purge \u2014 purging ${ids.length} session memor${ids.length === 1 ? "y" : "ies"} (session: ${CURRENT_SESSION_ID})`);
        Promise.allSettled(
          ids.map(
            (id) => sulcusMem.delete_memory(id, false).catch(() => {
            })
          )
        ).then((results) => {
          const deleted = results.filter((r) => r.status === "fulfilled").length;
          logger.info(`sulcus: session_purge \u2014 purged ${deleted}/${ids.length} session memor${ids.length === 1 ? "y" : "ies"}`);
        }).catch(() => {
        });
      });
      logger.info(`sulcus: registered session_purge (agent_end) for session ${CURRENT_SESSION_ID}`);
    }
    const dreamEnabled = pluginConfig?.dreamAutoTrigger !== false;
    const dreamSessionInterval = pluginConfig?.dreamSessionInterval ?? 10;
    const dreamMinGapMs = (pluginConfig?.dreamMinGapHours ?? 24) * 36e5;
    const dreamMinMemories = pluginConfig?.dreamMinMemories ?? 50;
    const dreamMinHeat = pluginConfig?.dreamConsolidateMinHeat ?? 0.1;
    if (dreamEnabled && isAvailable && sulcusMem instanceof SulcusCloudClient) {
      let readDreamState = function() {
        try {
          if ((0, import_node_fs.existsSync)(dreamStateFile)) {
            const raw = (0, import_node_fs.readFileSync)(dreamStateFile, "utf-8");
            const parsed = JSON.parse(raw);
            return {
              lastDreamMs: typeof parsed.lastDreamMs === "number" ? parsed.lastDreamMs : 0,
              lastSessionCount: typeof parsed.lastSessionCount === "number" ? parsed.lastSessionCount : 0
            };
          }
        } catch {
        }
        return { lastDreamMs: 0, lastSessionCount: 0 };
      }, writeDreamState = function(state) {
        try {
          (0, import_node_fs.writeFileSync)(dreamStateFile, JSON.stringify(state));
        } catch {
        }
      }, acquireDreamLock = function() {
        try {
          if ((0, import_node_fs.existsSync)(dreamLockFile)) {
            const lockAge = Date.now() - (JSON.parse((0, import_node_fs.readFileSync)(dreamLockFile, "utf-8")).ts ?? 0);
            if (lockAge < 6e5) return false;
          }
          (0, import_node_fs.writeFileSync)(dreamLockFile, JSON.stringify({ ts: Date.now(), pid: process.pid }));
          return true;
        } catch {
          return false;
        }
      }, releaseDreamLock = function() {
        try {
          if ((0, import_node_fs.existsSync)(dreamLockFile)) require("node:fs").unlinkSync(dreamLockFile);
        } catch {
        }
      };
      const stateDir = (0, import_node_path.resolve)(__dirname, ".sulcus-state");
      if (!(0, import_node_fs.existsSync)(stateDir)) (0, import_node_fs.mkdirSync)(stateDir, { recursive: true });
      const dreamStateFile = (0, import_node_path.resolve)(stateDir, "dream-state.json");
      const dreamLockFile = (0, import_node_path.resolve)(stateDir, "dream.lock");
      let dreamSessionCount = 0;
      const origBeforePromptBuild = api.on;
      origBeforePromptBuild("session_start", async () => {
        dreamSessionCount++;
      });
      const dreamApiOn = api.on;
      dreamApiOn("agent_end", async () => {
        if (dreamSessionCount % dreamSessionInterval !== 0) return;
        if (dreamSessionCount === 0) return;
        const state = readDreamState();
        const elapsed = Date.now() - state.lastDreamMs;
        if (elapsed < dreamMinGapMs) {
          logger.info(`sulcus/dream: gate 2 skip \u2014 ${Math.round(elapsed / 36e5)}h since last dream (need ${Math.round(dreamMinGapMs / 36e5)}h)`);
          return;
        }
        try {
          const statusResp = await sulcusMem.request("GET", "/api/v1/agent/memory/status");
          const stats = statusResp?.stats;
          const totalMemories = typeof stats?.total_memories === "number" ? stats.total_memories : 0;
          if (totalMemories < dreamMinMemories) {
            logger.info(`sulcus/dream: gate 3 skip \u2014 ${totalMemories} memories (need ${dreamMinMemories})`);
            return;
          }
          logger.info(`sulcus/dream: gates passed \u2014 ${totalMemories} memories, ${Math.round(elapsed / 36e5)}h since last dream`);
        } catch (e) {
          logger.warn(`sulcus/dream: gate 3 error \u2014 ${e instanceof Error ? e.message : e}`);
          return;
        }
        if (!acquireDreamLock()) {
          logger.info("sulcus/dream: lock held \u2014 another consolidation in progress");
          return;
        }
        logger.info(`sulcus/dream: triggering consolidation (minHeat=${dreamMinHeat})`);
        sulcusMem.consolidate(dreamMinHeat).then((result) => {
          writeDreamState({ lastDreamMs: Date.now(), lastSessionCount: dreamSessionCount });
          logger.info(`sulcus/dream: consolidation complete \u2014 ${JSON.stringify(result)}`);
        }).catch((e) => {
          logger.warn(`sulcus/dream: consolidation failed \u2014 ${e instanceof Error ? e.message : e}`);
        }).finally(() => {
          releaseDreamLock();
        });
      });
      logger.info(`sulcus: dream auto-trigger enabled (every ${dreamSessionInterval} sessions, ${Math.round(dreamMinGapMs / 36e5)}h gap, min ${dreamMinMemories} memories)`);
    }
    const outputGuardCfg = parseOutputGuardConfig(pluginConfig);
    if (outputGuardCfg.enabled) {
      const llmOutputApiOn = api.on;
      llmOutputApiOn("llm_output", async (event) => {
        const t0 = Date.now();
        try {
          const content = event?.content ?? event?.text ?? "";
          if (!content) {
            lastGuardFlags = null;
            return void 0;
          }
          let piiSpans = [];
          if (outputGuardCfg.pii.enabled) {
            piiSpans = scanForPii(content, outputGuardCfg.pii.patterns, outputGuardCfg.pii.customPatterns);
          }
          let suspectedPrefViolation = false;
          let suspectedReason;
          if (outputGuardCfg.preferenceViolation.enabled && negPrefCache && negPrefCache.namespace === namespace) {
            const lowerContent = content.toLowerCase();
            for (const pref of negPrefCache.prefs) {
              if (lowerContent.includes(pref.toLowerCase())) {
                suspectedPrefViolation = true;
                suspectedReason = `Content contains term matching stored negative preference: "${pref.slice(0, 50)}"`;
                break;
              }
            }
          }
          const flags = {
            piiDetected: piiSpans.length > 0,
            piiSpans,
            suspectedPreferenceViolation: suspectedPrefViolation,
            suspectedViolationReason: suspectedReason,
            scanTimeMs: Date.now() - t0
          };
          lastGuardFlags = flags;
          logger.debug?.(`sulcus/output-guard: llm_output scan complete (${flags.scanTimeMs}ms, pii=${flags.piiDetected}, prefViolation=${flags.suspectedPreferenceViolation})`);
          return void 0;
        } catch (err) {
          logger.warn(`sulcus/output-guard: llm_output threw: ${err}`);
          lastGuardFlags = null;
          return outputGuardCfg.failMode === "fail-closed" ? { content: "\u26A0\uFE0F Output guardrail error \u2014 message blocked (fail-closed mode)." } : void 0;
        }
      });
      const msgSendingApiOn = api.on;
      msgSendingApiOn("message_sending", async (event) => {
        try {
          const content = event?.content ?? event?.text ?? event?.message ?? "";
          if (!content) return void 0;
          const flags = lastGuardFlags ?? (() => {
            const t0 = Date.now();
            const piiSpans = outputGuardCfg.pii.enabled ? scanForPii(content, outputGuardCfg.pii.patterns, outputGuardCfg.pii.customPatterns) : [];
            return {
              piiDetected: piiSpans.length > 0,
              piiSpans,
              suspectedPreferenceViolation: false,
              scanTimeMs: Date.now() - t0
            };
          })();
          lastGuardFlags = null;
          let modified = false;
          let finalContent = content;
          const auditEvents = [];
          if (outputGuardCfg.pii.enabled && flags.piiDetected) {
            switch (outputGuardCfg.pii.onViolation) {
              case "redact": {
                if (outputGuardCfg.pii.reversible) {
                  storeRedactionKey(flags.piiSpans, content, outputGuardCfg.pii.storageKey, namespace);
                }
                finalContent = redactSpans(finalContent, flags.piiSpans);
                modified = true;
                auditEvents.push({ eventType: "pii_redacted", action: "redact", details: `${flags.piiSpans.length} span(s) redacted (types: ${[...new Set(flags.piiSpans.map((s) => s.type))].join(", ")})` });
                logger.info(`sulcus/output-guard: redacted ${flags.piiSpans.length} PII span(s)`);
                break;
              }
              case "replace":
              case "block": {
                finalContent = `\u26A0\uFE0F This message contained personal information (${[...new Set(flags.piiSpans.map((s) => s.type))].join(", ")}) and was blocked by the output guard. Please rephrase without including identifiable data.`;
                modified = true;
                auditEvents.push({ eventType: "pii_blocked", action: outputGuardCfg.pii.onViolation, details: `${flags.piiSpans.length} span(s) blocked` });
                logger.info(`sulcus/output-guard: blocked message containing PII (${outputGuardCfg.pii.onViolation})`);
                break;
              }
            }
          }
          if (outputGuardCfg.preferenceViolation.enabled && flags.suspectedPreferenceViolation && sulcusMem instanceof SulcusCloudClient) {
            try {
              const now = Date.now();
              if (!negPrefCache || negPrefCache.namespace !== namespace || now - negPrefCache.cachedAt > NEG_PREF_CACHE_TTL_MS) {
                const prefRes = await sulcusMem.search_memory("negative preference dislike avoid", 10, namespace);
                const prefMemories = prefRes?.results ?? [];
                const prefTexts = prefMemories.filter((m) => {
                  const mtype = m.memory_type;
                  return !mtype || mtype === "preference";
                }).map((m) => (m.label ?? m.content ?? "").toLowerCase()).filter((t) => t.length > 3);
                negPrefCache = { prefs: prefTexts, cachedAt: now, namespace };
              }
              const lowerFinal = finalContent.toLowerCase();
              let confirmedViolation = false;
              let violatedPref = "";
              for (const pref of negPrefCache.prefs) {
                if (lowerFinal.includes(pref.toLowerCase().slice(0, 30))) {
                  confirmedViolation = true;
                  violatedPref = pref.slice(0, 80);
                  break;
                }
              }
              if (confirmedViolation) {
                const replacement = outputGuardCfg.preferenceViolation.replacementMessage;
                switch (outputGuardCfg.preferenceViolation.onViolation) {
                  case "replace":
                  case "block":
                    finalContent = replacement;
                    modified = true;
                    auditEvents.push({ eventType: "preference_violation", action: outputGuardCfg.preferenceViolation.onViolation, details: `Violated preference: "${violatedPref}"` });
                    logger.info(`sulcus/output-guard: preference violation \u2014 replaced message (pref: "${violatedPref.slice(0, 50)}")`);
                    break;
                  case "warn":
                    finalContent = `\u26A0\uFE0F Note: This response may conflict with your stored preferences.

${finalContent}`;
                    modified = true;
                    auditEvents.push({ eventType: "preference_violation", action: "warn", details: `Possible conflict with preference: "${violatedPref}"` });
                    break;
                }
              }
            } catch (prefErr) {
              logger.warn(`sulcus/output-guard: preference check failed: ${prefErr}`);
              if (outputGuardCfg.failMode === "fail-closed") {
                finalContent = "\u26A0\uFE0F Output guardrail check failed \u2014 message blocked (fail-closed mode).";
                modified = true;
              }
            }
          }
          if (auditEvents.length > 0) {
            for (const evt of auditEvents) {
              pushGuardrailEvent({
                capturedAt: Date.now(),
                guard: "output",
                eventType: evt.eventType,
                action: evt.action,
                details: evt.details
              });
            }
            if (outputGuardCfg.auditTrail && sulcusMem instanceof SulcusCloudClient) {
              for (const evt of auditEvents) {
                sulcusMem.store({
                  content: `[output_guard] ${evt.eventType}: ${evt.details}. Action: ${evt.action}. Timestamp: ${(/* @__PURE__ */ new Date()).toISOString()}.`,
                  memory_type: "episodic",
                  metadata: { _source: "output_guard", eventType: evt.eventType, action: evt.action, namespace }
                }).catch(() => {
                });
              }
            }
          }
          if (modified) {
            return { content: finalContent };
          }
          return void 0;
        } catch (err) {
          logger.warn(`sulcus/output-guard: message_sending threw: ${err}`);
          return outputGuardCfg.failMode === "fail-closed" ? { content: "\u26A0\uFE0F Output guardrail error \u2014 message blocked (fail-closed mode)." } : void 0;
        }
      });
      logger.info(`sulcus/output-guard: registered (pii=${outputGuardCfg.pii.enabled}, prefViolation=${outputGuardCfg.preferenceViolation.enabled}, failMode=${outputGuardCfg.failMode})`);
    } else {
      logger.info("sulcus/output-guard: disabled (set guardrails.outputGuard.enabled=true to activate)");
    }
    if (captureFromAssistant && isAvailable && sulcusMem) {
      const assistantCaptureApiOn = api.on;
      assistantCaptureApiOn("llm_output", async (event) => {
        try {
          const content = event?.content ?? event?.text ?? "";
          if (!content || typeof content !== "string") return void 0;
          if (isGenericAck(content)) {
            logger.debug?.("sulcus: assistant_capture \u2014 skipping generic ack");
            return void 0;
          }
          if (isJunkMemory(content)) {
            logger.debug?.(`sulcus: assistant_capture \u2014 skipping junk: "${content.substring(0, 50)}..."`);
            return void 0;
          }
          const captureText = content.length > ASSISTANT_CAPTURE_MAX_DIRECT ? summarizeForCapture(content, namespace) : content;
          if (!shouldCapture(captureText)) {
            logger.debug?.("sulcus: assistant_capture \u2014 dedup skip");
            return void 0;
          }
          if (sulcusMem instanceof SulcusCloudClient) {
            try {
              const siuResult = await sulcusMem.request("POST", "/api/v2/siu/label", { text: captureText });
              const storeConf = siuResult?.store_confidence ?? 0;
              const shouldStore = siuResult?.store === true && storeConf >= 0.4;
              if (!shouldStore) {
                logger.debug?.(`sulcus: assistant_capture \u2014 SIVU rejected (conf: ${storeConf.toFixed(3)}): "${captureText.substring(0, 60)}..."`);
                return void 0;
              }
              const memoryType = siuResult?.memory_type ?? "episodic";
              const hints = buildExtractionHints(memoryType, namespace, "assistant_capture", captureText.substring(0, 200));
              const res = await sulcusMem.add_memory(captureText, memoryType, hints);
              logger.info(`sulcus: assistant_capture \u2014 stored [${memoryType}] (id: ${res?.id ?? "?"}, conf: ${storeConf.toFixed(3)}): "${captureText.substring(0, 60)}..."`);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              logger.warn(`sulcus: assistant_capture \u2014 SIVU error: ${msg}`);
              try {
                const hints = buildExtractionHints("episodic", namespace, "assistant_capture", captureText.substring(0, 200));
                const res = await sulcusMem.add_memory(captureText, "episodic", hints);
                logger.info(`sulcus: assistant_capture \u2014 fallback stored [episodic] (id: ${res?.id ?? "?"}): "${captureText.substring(0, 60)}..."`);
              } catch (fe) {
                logger.warn(`sulcus: assistant_capture \u2014 fallback failed: ${fe instanceof Error ? fe.message : fe}`);
              }
            }
          }
          return void 0;
        } catch (err) {
          logger.warn("sulcus: assistant_capture \u2014 hook threw: " + err);
          return void 0;
        }
      });
      logger.info("sulcus: registered assistant_capture (llm_output hook, captureFromAssistant=true)");
    } else if (!captureFromAssistant) {
      logger.debug?.("sulcus: assistant_capture disabled (set captureFromAssistant=true to activate)");
    }
    const toolGuardCfg = parseToolGuardConfig(pluginConfig);
    guardrailStatus = {
      outputGuard: {
        enabled: outputGuardCfg.enabled,
        pii: {
          enabled: outputGuardCfg.pii.enabled,
          patterns: outputGuardCfg.pii.patterns,
          onViolation: outputGuardCfg.pii.onViolation,
          reversible: outputGuardCfg.pii.reversible
        },
        preferenceViolation: {
          enabled: outputGuardCfg.preferenceViolation.enabled,
          onViolation: outputGuardCfg.preferenceViolation.onViolation
        },
        failMode: outputGuardCfg.failMode,
        auditTrail: outputGuardCfg.auditTrail
      },
      toolGuard: {
        enabled: toolGuardCfg.enabled,
        sensitiveTools: toolGuardCfg.sensitiveTools,
        allowlist: toolGuardCfg.allowlist,
        blocklist: toolGuardCfg.blocklist,
        objectiveCheck: toolGuardCfg.objectiveCheck,
        requireApprovalThreshold: toolGuardCfg.requireApprovalThreshold,
        failMode: toolGuardCfg.failMode,
        auditTrail: toolGuardCfg.auditTrail
      },
      negPrefCount: () => negPrefCache?.prefs.length ?? 0,
      negPrefCachedAt: () => negPrefCache?.cachedAt ?? null
    };
    if (toolGuardCfg.enabled) {
      const toolGuardApiOn = api.on;
      toolGuardApiOn("before_tool_call", async (event) => {
        try {
          const toolName = event?.name ?? event?.function ?? event?.tool_name ?? "";
          const toolArgs = event?.arguments ?? event?.input ?? event?.params ?? {};
          if (!toolName) {
            logger.warn("sulcus/tool-guard: no tool name in event \u2014 allowing by default");
            return { allow: true };
          }
          if (toolGuardCfg.allowlist.length > 0 && toolGuardCfg.allowlist.includes(toolName)) {
            pushGuardrailEvent({ capturedAt: Date.now(), guard: "tool", eventType: "tool_allowed", action: "allow", details: `Allowlisted tool: ${toolName}`, toolName, severity: "info" });
            if (toolGuardCfg.auditTrail && sulcusMem instanceof SulcusCloudClient) {
              sulcusMem.add_memory(
                `[tool_guard] ${toolName}: allowed (allowlist). Args: ${JSON.stringify(toolArgs).slice(0, 200)}`,
                "episodic",
                { _source: "tool_guard" }
              ).catch(() => {
              });
            }
            return { allow: true };
          }
          if (toolGuardCfg.blocklist.length > 0 && toolGuardCfg.blocklist.includes(toolName)) {
            const reason2 = `Tool '${toolName}' is on the blocklist and cannot be used.`;
            pushGuardrailEvent({ capturedAt: Date.now(), guard: "tool", eventType: "tool_blocked", action: "block", details: `Blocklisted tool: ${toolName}`, toolName, severity: "critical" });
            if (toolGuardCfg.auditTrail && sulcusMem instanceof SulcusCloudClient) {
              sulcusMem.add_memory(
                `[tool_guard] ${toolName}: blocked (blocklist). Reason: ${reason2}`,
                "episodic",
                { _source: "tool_guard" }
              ).catch(() => {
              });
            }
            logger.info(`sulcus/tool-guard: blocked tool '${toolName}' (blocklist)`);
            return { block: true, reason: reason2 };
          }
          const isSensitive = toolGuardCfg.sensitiveTools.includes(toolName);
          if (!isSensitive) {
            return { allow: true };
          }
          let severity = "info";
          let reason = "";
          if (toolGuardCfg.objectiveCheck && sulcusMem instanceof SulcusCloudClient) {
            try {
              const objectiveRes = await sulcusMem.search_memory(`objective goal preference ${toolName}`, 5, namespace);
              const objectives = objectiveRes?.results ?? [];
              const toolDescription = `Tool call: ${toolName} with args ${JSON.stringify(toolArgs).slice(0, 200)}`;
              let hasConflict = false;
              let conflictingObjective = "";
              for (const obj of objectives) {
                const content = (obj.label ?? obj.content ?? "").toLowerCase();
                const toolLower = toolName.toLowerCase();
                if (content.includes("never") || content.includes("don't") || content.includes("avoid")) {
                  if (content.includes(toolLower) || toolName === "exec" && (content.includes("command") || content.includes("execute")) || toolName === "write" && content.includes("file") || toolName === "edit" && content.includes("modify") || toolName === "delete" && content.includes("remove")) {
                    hasConflict = true;
                    conflictingObjective = obj.label ?? obj.content ?? "";
                    break;
                  }
                }
              }
              if (hasConflict) {
                severity = "critical";
                reason = `This tool call conflicts with stored preference: "${conflictingObjective.slice(0, 100)}"`;
              } else if (objectives.length === 0) {
                severity = "info";
                reason = "No relevant objectives found in memory \u2014 proceeding with caution.";
              } else {
                severity = "warning";
                reason = "Tool call is sensitive but appears aligned with stored objectives.";
              }
            } catch (objErr) {
              logger.warn(`sulcus/tool-guard: objective check failed: ${objErr}`);
              if (toolGuardCfg.failMode === "fail-closed") {
                return { block: true, reason: "Tool guard objective check failed (fail-closed mode)." };
              }
              severity = "info";
              reason = "Objective check failed \u2014 allowing with reduced confidence.";
            }
          } else {
            severity = "warning";
            reason = `Tool '${toolName}' is marked as sensitive. Please verify this action is intended.`;
          }
          const severityLevels = { "info": 0, "warning": 1, "critical": 2 };
          const currentLevel = severityLevels[severity];
          const thresholdLevel = severityLevels[toolGuardCfg.requireApprovalThreshold];
          {
            const decision = currentLevel >= thresholdLevel ? "require_approval" : "allow";
            pushGuardrailEvent({
              capturedAt: Date.now(),
              guard: "tool",
              eventType: currentLevel >= thresholdLevel ? "tool_require_approval" : "tool_allowed",
              action: decision,
              details: reason.slice(0, 200),
              toolName,
              severity
            });
            if (toolGuardCfg.auditTrail && sulcusMem instanceof SulcusCloudClient) {
              sulcusMem.add_memory(
                `[tool_guard] ${toolName}: ${decision}. Severity: ${severity}. Reason: ${reason}. Args: ${JSON.stringify(toolArgs).slice(0, 200)}`,
                "episodic",
                { _source: "tool_guard" }
              ).catch(() => {
              });
            }
          }
          if (currentLevel >= thresholdLevel) {
            logger.info(`sulcus/tool-guard: requiring approval for '${toolName}' (severity: ${severity}, threshold: ${toolGuardCfg.requireApprovalThreshold})`);
            return {
              requireApproval: true,
              severity,
              reason: `${reason}

Tool: ${toolName}
Arguments: ${JSON.stringify(toolArgs, null, 2)}`
            };
          } else {
            logger.debug?.(`sulcus/tool-guard: allowing '${toolName}' (severity: ${severity} below threshold: ${toolGuardCfg.requireApprovalThreshold})`);
            return { allow: true };
          }
        } catch (err) {
          logger.warn(`sulcus/tool-guard: before_tool_call threw: ${err}`);
          if (toolGuardCfg.failMode === "fail-closed") {
            return { block: true, reason: "Tool guard error \u2014 blocked (fail-closed mode)." };
          }
          return { allow: true };
        }
      });
      logger.info(`sulcus/tool-guard: registered (sensitiveTools=${toolGuardCfg.sensitiveTools.length}, objectiveCheck=${toolGuardCfg.objectiveCheck}, threshold=${toolGuardCfg.requireApprovalThreshold}, failMode=${toolGuardCfg.failMode})`);
    } else {
      logger.info("sulcus/tool-guard: disabled (set guardrails.toolGuard.enabled=true to activate)");
    }
    for (const [hookName, hookConfig] of Object.entries(hooksConfig.hooks)) {
      if (!hookConfig.enabled) continue;
      if (hookName === "before_agent_start" && autoRecall && isCloudBackend) continue;
      if (hookName === "before_prompt_build" && isCloudBackend && sulcusMem) continue;
      if (hookName === "agent_end" && autoCapture && hookConfig.action === "sivu_auto_capture") continue;
      const handler = hookHandlers[hookConfig.action];
      if (handler) {
        const apiOn = api.on;
        apiOn(hookName, async (event) => {
          try {
            return await handler(event, hookConfig, handlerCtx);
          } catch (err) {
            logger.warn("sulcus: hook " + hookName + " (action=" + hookConfig.action + ") threw: " + err);
            return void 0;
          }
        });
      } else {
        logger.warn("sulcus: unknown hook action " + hookConfig.action + " for hook " + hookName);
      }
    }
    for (const [toolName, toolConfig] of Object.entries(hooksConfig.tools)) {
      if (!toolConfig.enabled) continue;
      const toolDef = toolDefinitions[toolName];
      if (toolDef) {
        const schema = {
          ...toolDef.schema,
          async execute(id, params) {
            return toolDef.makeExecute(toolDeps)(id, params);
          }
        };
        const registerTool = api.registerTool;
        registerTool(schema, toolDef.options);
      } else {
        logger.warn("sulcus: unknown tool " + toolName + " in config \u2014 skipping");
      }
    }
    const registerCli = api.registerCli;
    if (typeof registerCli === "function") {
      registerCli((ctx) => {
        const sulcusCmd = ctx.program.command("sulcus").description("Sulcus memory management");
        sulcusCmd.command("status").description("Check Sulcus connection, config, and memory stats").option("--json", "Machine-readable JSON output").action(async (opts) => {
          if (!isAvailable || !sulcusMem) {
            const out = { status: "unavailable", backend: backendMode, namespace, error: "Backend not connected" };
            if (opts.json) {
              console.log(JSON.stringify(out, null, 2));
            } else {
              console.log(`Status: unavailable`);
              console.log(`Backend: ${backendMode}`);
              console.log(`Namespace: ${namespace}`);
              if (serverUrl) console.log(`Server: ${serverUrl}`);
              console.log(`
Run \`openclaw sulcus init\` to configure.`);
            }
            return;
          }
          try {
            const status = await sulcusMem.request("GET", "/api/v1/agent/memory/status");
            const hot = await sulcusMem.list_hot_nodes(5);
            const out = {
              status: "connected",
              backend: backendMode,
              namespace,
              server: serverUrl,
              autoRecall,
              autoCapture,
              ...status?.stats ? { stats: status.stats } : {},
              ...status?.capabilities ? { capabilities: status.capabilities } : {},
              hot_nodes: (hot.nodes || []).length
            };
            if (opts.json) {
              console.log(JSON.stringify(out, null, 2));
            } else {
              console.log(`Status: connected \u2705`);
              console.log(`Backend: ${backendMode}`);
              console.log(`Namespace: ${namespace}`);
              console.log(`Server: ${serverUrl}`);
              console.log(`Auto-recall: ${autoRecall}`);
              console.log(`Auto-capture: ${autoCapture}`);
              const stats = status?.stats;
              if (stats?.total_memories !== void 0) console.log(`Memories: ${stats.total_memories}`);
              if (stats?.average_heat !== void 0) console.log(`Average heat: ${stats.average_heat.toFixed(3)}`);
              console.log(`Hot nodes: ${(hot.nodes || []).length}`);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (opts.json) {
              console.log(JSON.stringify({ status: "error", error: msg }));
            } else {
              console.error(`Error: ${msg}`);
            }
          }
        });
        sulcusCmd.command("search <query>").description("Search memories").option("-n, --limit <n>", "Max results", "10").option("--json", "Machine-readable JSON output").action(async (query, opts) => {
          if (!isAvailable || !sulcusMem) {
            console.error("Sulcus not connected.");
            return;
          }
          try {
            const res = await sulcusMem.search_memory(query, parseInt(opts.limit, 10), namespace);
            const results = res?.results ?? [];
            if (opts.json) {
              console.log(JSON.stringify(results, null, 2));
              return;
            }
            if (results.length === 0) {
              console.log("No results.");
              return;
            }
            for (const r of results) {
              const heat = typeof r.current_heat === "number" ? (r.current_heat * 100).toFixed(0) + "%" : "?";
              const mtype = r.memory_type ?? "?";
              const label = (r.label ?? r.content ?? "").slice(0, 120);
              console.log(`[${heat} ${mtype}] ${label}`);
              console.log(`  id: ${r.id}`);
            }
            console.log(`
${results.length} result(s)`);
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
        sulcusCmd.command("add <content>").description("Store a memory").option("-t, --type <type>", "Memory type", "semantic").option("--json", "Machine-readable JSON output").action(async (content, opts) => {
          if (!isAvailable || !sulcusMem) {
            console.error("Sulcus not connected.");
            return;
          }
          try {
            const hints = buildExtractionHints(opts.type, namespace, "cli_add", content.substring(0, 200));
            const res = await sulcusMem.add_memory(content, opts.type, hints);
            if (opts.json) {
              console.log(JSON.stringify(res, null, 2));
            } else {
              console.log(`Stored [${opts.type}] memory (id: ${res?.id ?? "?"})`);
            }
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
        sulcusCmd.command("get <id>").description("Fetch a memory by ID").option("--json", "Machine-readable JSON output").action(async (id, opts) => {
          if (!isAvailable || !(sulcusMem instanceof SulcusCloudClient)) {
            console.error("Sulcus not connected.");
            return;
          }
          try {
            const res = await sulcusMem.get_memory(id);
            if (!res) {
              console.log(`Memory ${id} not found.`);
              return;
            }
            if (opts.json) {
              console.log(JSON.stringify(res, null, 2));
            } else {
              const heat = typeof res.current_heat === "number" ? (res.current_heat * 100).toFixed(0) + "%" : "?";
              console.log(`ID: ${res.id}`);
              console.log(`Type: ${res.memory_type ?? "?"}`);
              console.log(`Heat: ${heat}`);
              console.log(`Pinned: ${res.is_pinned ?? false}`);
              console.log(`Content: ${(res.label ?? res.content ?? "").slice(0, 500)}`);
            }
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
        sulcusCmd.command("list").description("List memories").option("-n, --limit <n>", "Max results", "20").option("-t, --type <type>", "Filter by memory type").option("--pinned", "Only pinned memories").option("--sort <field>", "Sort by: current_heat, created_at, updated_at", "current_heat").option("--json", "Machine-readable JSON output").action(async (opts) => {
          if (!isAvailable || !(sulcusMem instanceof SulcusCloudClient)) {
            console.error("Sulcus not connected.");
            return;
          }
          try {
            const res = await sulcusMem.list_memories({
              page_size: parseInt(opts.limit, 10),
              memory_type: opts.type,
              pinned: opts.pinned,
              sort_by: opts.sort,
              sort_order: "desc",
              namespace
            });
            if (opts.json) {
              console.log(JSON.stringify(res, null, 2));
              return;
            }
            if (res.items.length === 0) {
              console.log("No memories.");
              return;
            }
            for (const r of res.items) {
              const heat = typeof r.current_heat === "number" ? (r.current_heat * 100).toFixed(0) + "%" : "?";
              const mtype = r.memory_type ?? "?";
              const label = (r.label ?? r.content ?? "").slice(0, 100);
              console.log(`[${heat} ${mtype}] ${label}`);
              console.log(`  id: ${r.id}`);
            }
            console.log(`
${res.items.length} shown${res.total ? ` of ${res.total}` : ""}`);
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
        sulcusCmd.command("update <id>").description("Update a memory").option("-c, --content <text>", "New content").option("-t, --type <type>", "New memory type").option("--pin", "Pin the memory").option("--unpin", "Unpin the memory").option("--heat <value>", "Set heat (0.0-1.0)").option("--json", "Machine-readable JSON output").action(async (id, opts) => {
          if (!isAvailable || !(sulcusMem instanceof SulcusCloudClient)) {
            console.error("Sulcus not connected.");
            return;
          }
          const updates = {};
          if (opts.content) updates.label = opts.content;
          if (opts.type) updates.memory_type = opts.type;
          if (opts.pin) updates.is_pinned = true;
          if (opts.unpin) updates.is_pinned = false;
          if (opts.heat) updates.current_heat = parseFloat(opts.heat);
          if (Object.keys(updates).length === 0) {
            console.error("No fields to update.");
            return;
          }
          try {
            const res = await sulcusMem.update_memory(id, updates);
            if (opts.json) {
              console.log(JSON.stringify(res, null, 2));
            } else {
              console.log(`Updated memory ${id} (${Object.keys(updates).join(", ")})`);
            }
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
        sulcusCmd.command("delete <id>").description("Delete a memory").option("--no-train", "Don't train SIVU to reject similar").option("--json", "Machine-readable JSON output").action(async (id, opts) => {
          if (!isAvailable || !sulcusMem) {
            console.error("Sulcus not connected.");
            return;
          }
          try {
            const train = opts.train !== false;
            await sulcusMem.delete_memory(id, train);
            if (opts.json) {
              console.log(JSON.stringify({ deleted: id, trained: train }));
            } else {
              console.log(`Deleted memory ${id}${train ? " (trained SIVU)" : ""}`);
            }
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
        sulcusCmd.command("export").description("Export all memories as Markdown").action(async () => {
          if (!isAvailable || !sulcusMem) {
            console.error("Sulcus not connected.");
            return;
          }
          try {
            const md = await sulcusMem.export_markdown();
            console.log(md);
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
        sulcusCmd.command("import <file>").description("Import memories from a Markdown file").action(async (file) => {
          if (!isAvailable || !sulcusMem) {
            console.error("Sulcus not connected.");
            return;
          }
          try {
            const { readFileSync: readFileSync2 } = require("fs");
            const text = readFileSync2(file, "utf-8");
            const res = await sulcusMem.import_markdown(text);
            console.log(JSON.stringify(res, null, 2));
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
        sulcusCmd.command("consolidate").description("Run dream/consolidation on cold memories").option("--min-heat <value>", "Heat threshold (0.0-1.0)", "0.1").option("--json", "Machine-readable JSON output").action(async (opts) => {
          if (!isAvailable || !sulcusMem) {
            console.error("Sulcus not connected.");
            return;
          }
          try {
            const res = await sulcusMem.consolidate(parseFloat(opts.minHeat));
            if (opts.json) {
              console.log(JSON.stringify(res, null, 2));
            } else {
              console.log("Consolidation complete.");
              console.log(JSON.stringify(res, null, 2));
            }
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
        sulcusCmd.command("hot").description("Show hottest memories").option("-n, --limit <n>", "Max results", "10").option("--json", "Machine-readable JSON output").action(async (opts) => {
          if (!isAvailable || !sulcusMem) {
            console.error("Sulcus not connected.");
            return;
          }
          try {
            const res = await sulcusMem.list_hot_nodes(parseInt(opts.limit, 10));
            const nodes = res?.nodes ?? [];
            if (opts.json) {
              console.log(JSON.stringify(nodes, null, 2));
              return;
            }
            if (nodes.length === 0) {
              console.log("No hot nodes.");
              return;
            }
            for (const n of nodes) {
              const heat = typeof n.current_heat === "number" ? (n.current_heat * 100).toFixed(0) + "%" : "?";
              const label = (n.label ?? n.pointer_summary ?? "").slice(0, 100);
              console.log(`[${heat}] ${label}`);
            }
          } catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : e}`);
          }
        });
        logger.info("sulcus: registered CLI commands (openclaw sulcus <cmd>)");
      }, {
        commands: ["sulcus"],
        descriptors: [{
          name: "sulcus",
          description: "Sulcus memory management \u2014 status, search, add, get, list, update, delete, export, import, consolidate, hot",
          hasSubcommands: true
        }]
      });
    } else {
      logger.info("sulcus: registerCli not available \u2014 CLI commands skipped");
    }
    const registerCommand = api.registerCommand;
    if (typeof registerCommand === "function") {
      try {
        registerCommand({
          name: "sulcus",
          description: "Sulcus memory status and configuration. Usage: /sulcus [status|config|set <key> <value>]",
          acceptsArgs: true,
          requireAuth: false,
          handler: async (ctx) => {
            const rawArgs = (ctx.args ?? "").trim();
            const parts = rawArgs.split(/\s+/);
            const subcommand = (parts[0] || "status").toLowerCase();
            if (subcommand === "status" || subcommand === "") {
              const lines = [];
              lines.push(`\u{1F9E0} **Sulcus Memory** \u2014 v${api.version || "6.6.5"}`);
              lines.push(`**Backend:** ${backendMode}`);
              lines.push(`**Namespace:** ${namespace}`);
              lines.push(`**Token Budget:** ${tokenBudget}`);
              lines.push(`**Auto-Recall:** ${autoRecall ? "\u2705" : "\u274C"}`);
              lines.push(`**Auto-Capture:** ${autoCapture ? "\u2705" : "\u274C"}`);
              lines.push(`**Max Recall Results:** ${maxRecallResults}`);
              lines.push(`**Min Recall Score:** ${pluginConfig?.minRecallScore ?? 0.3}`);
              lines.push(`**Profile Frequency:** every ${profileFrequency} turns`);
              lines.push(`**Capture from Assistant:** ${captureFromAssistant ? "\u2705" : "\u274C"}`);
              lines.push(`**Context Rebuild:** ${contextRebuildEnabled ? "\u2705" : "\u274C"} (budget: ${contextRebuildBudget})`);
              lines.push(`**Boost on Recall:** ${boostOnRecallEnabled ? "\u2705" : "\u274C"}`);
              if (isAvailable && sulcusMem instanceof SulcusCloudClient) {
                try {
                  const stats = await sulcusMem.get_stats();
                  if (stats) {
                    lines.push(`**Memories:** ${stats.total_memories ?? "?"} total`);
                    if (stats.hot_count != null) lines.push(`**Hot Nodes:** ${stats.hot_count}`);
                  }
                } catch {
                }
              }
              return { text: lines.join("\n") };
            }
            if (subcommand === "config") {
              const configKeys = [
                `tokenBudget: ${tokenBudget} (100\u201316000, default 10000)`,
                `maxRecallResults: ${maxRecallResults} (1\u201320, default 5)`,
                `minRecallScore: ${pluginConfig?.minRecallScore ?? 0.3} (0\u20131, default 0.3)`,
                `profileFrequency: ${profileFrequency} (1\u2013500, default 10)`,
                `autoRecall: ${autoRecall}`,
                `autoCapture: ${autoCapture}`,
                `captureFromAssistant: ${captureFromAssistant}`,
                `boostOnRecall: ${boostOnRecallEnabled}`,
                `contextWindowSize: ${contextWindowSize}`
              ];
              const lines = [
                "\u2699\uFE0F **Sulcus Configuration**",
                "",
                ...configKeys.map((k) => `\u2022 ${k}`),
                "",
                "**To change a value:**",
                "Set `tokenBudget` in your OpenClaw config:",
                "```json",
                JSON.stringify({ plugins: { entries: { "openclaw-sulcus": { config: { tokenBudget: 1e4 } } } } }, null, 2),
                "```",
                "Then restart to apply."
              ];
              return { text: lines.join("\n") };
            }
            if (subcommand === "help") {
              return { text: [
                "\u{1F9E0} **Sulcus Commands**",
                "",
                "\u2022 `/sulcus` or `/sulcus status` \u2014 Show memory status",
                "\u2022 `/sulcus config` \u2014 Show current configuration and how to change it",
                "\u2022 `/sulcus help` \u2014 This help message"
              ].join("\n") };
            }
            return { text: `Unknown subcommand: \`${subcommand}\`. Try \`/sulcus help\`.` };
          }
        });
        logger.info("sulcus: registered /sulcus chat command");
      } catch (e) {
        logger.warn(`sulcus: registerCommand failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (isAvailable && sulcusMem instanceof SulcusCloudClient) {
      importOpenClawHistory(sulcusMem, logger).catch((e) => {
        logger.warn(`sulcus: history import failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
  }
};
var index_default = sulcusPlugin;
