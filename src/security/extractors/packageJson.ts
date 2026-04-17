import type { DependencyExtractor } from "./index.js";
import { parsePackageJson } from "../../shared/parsers.js";

export const packageJsonExtractor: DependencyExtractor = {
  id: "npm-package-json",
  name: "npm (package.json)",
  detect(paths) {
    for (const p of paths) {
      if (p === "package.json") {
        return true;
      }
    }
    return false;
  },
  extract(files) {
    const content = files.get("package.json");
    return content ? parsePackageJson(content) : [];
  },
};
