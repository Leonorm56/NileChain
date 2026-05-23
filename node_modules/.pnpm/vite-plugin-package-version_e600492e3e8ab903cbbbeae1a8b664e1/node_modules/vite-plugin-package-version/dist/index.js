"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  default: () => src_default
});
module.exports = __toCommonJS(src_exports);
var envInjectionFailed = false;
var createPlugin = () => {
  return {
    name: "vite-plugin-package-version",
    config: (_, env) => {
      if (env) {
        const key = "import.meta.env.PACKAGE_VERSION";
        const val = JSON.stringify(process.env.npm_package_version);
        return { define: { [key]: val } };
      } else {
        envInjectionFailed = true;
      }
    },
    configResolved(config) {
      if (envInjectionFailed) {
        config.logger.warn(
          `[vite-plugin-package-version] import.meta.env.PACKAGE_VERSION was not injected due to incompatible vite version (requires vite@^2.0.0-beta.69).`
        );
      }
    }
  };
};
var src_default = createPlugin;
