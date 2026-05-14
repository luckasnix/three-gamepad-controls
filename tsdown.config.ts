import { defineConfig } from "tsdown";

const tsdownConfig = defineConfig({
  entry: {
    index: "src/index.ts",
  },
  dts: true,
  fixedExtension: false,
});

export default tsdownConfig;
