import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildTokensCss } from "../src/design/css";

const target = path.join(process.cwd(), "src/app/tokens.generated.css");
writeFileSync(target, buildTokensCss());
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
