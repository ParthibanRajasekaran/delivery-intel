import type { DependencyExtractor } from "./index.js";
import { parseGoMod } from "../../shared/parsers.js";

export const goModExtractor: DependencyExtractor = {
  id: "go-mod",
  name: "Go (go.mod)",
  detect(paths) {
    for (const p of paths) {
      if (p === "go.mod") {
        return true;
      }
    }
    return false;
  },
  extract(files) {
    const content = files.get("go.mod");
    return content ? parseGoMod(content) : [];
  },
};
