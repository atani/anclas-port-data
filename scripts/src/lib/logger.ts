const PREFIX = "[anclas-pipeline]";

export const logger = {
  info: (msg: string) => process.stdout.write(`${PREFIX} ${msg}\n`),
  warn: (msg: string) => process.stderr.write(`${PREFIX} WARN: ${msg}\n`),
  error: (msg: string) => process.stderr.write(`${PREFIX} ERROR: ${msg}\n`),
};
