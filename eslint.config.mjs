import { globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  globalIgnores([".next/**", ".vercel/**", "out/**", "node_modules/**"])
];

export default eslintConfig;
