import { defineConfig } from "tsdown";

const tsdownConfig = defineConfig({
  entry: {
    index: "src/index.ts",
  },
  dts: true,
  fixedExtension: false,
  unbundle: true,
});

export default tsdownConfig;
