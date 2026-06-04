import pino from "pino";

// pino-backed logger. Pretty output on a TTY (local desktop use), plain JSON
// otherwise. The `log.*` surface is kept stable so existing callers don't change.

const usePretty = process.stdout.isTTY && process.env.NODE_ENV !== "production";

const base = pino(
  usePretty
    ? {
        level: process.env.LOG_LEVEL ?? "info",
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : { level: process.env.LOG_LEVEL ?? "info" },
);

export const log = {
  info: (msg: string) => base.info(msg),
  ok: (msg: string) => base.info(msg),
  warn: (msg: string) => base.warn(msg),
  err: (msg: string) => base.error(msg),
  debug: (msg: string) => base.debug(msg),
  event: (tag: string, msg: string) => base.info({ tag }, msg),
  raw: (msg: string) => base.info(msg),
  /** Child logger with a bound component name. */
  child: (component: string) => base.child({ component }),
};

export type Logger = typeof log;
