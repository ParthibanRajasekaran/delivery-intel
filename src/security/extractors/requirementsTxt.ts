import type { DependencyExtractor } from "./index.js";
import { parseRequirementsTxt } from "../../shared/parsers.js";

export const requirementsTxtExtractor: DependencyExtractor = {
  id: "pypi-requirements-txt",
  name: "PyPI (requirements.txt)",
  detect(paths) {
    for (const p of paths) {
      if (p === "requirements.txt") {
        return true;
      }
    }
    return false;
  },
  extract(files) {
    const content = files.get("requirements.txt");
    return content ? parseRequirementsTxt(content) : [];
  },
};
