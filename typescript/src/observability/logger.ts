export type LogFields = Record<string, unknown>;

export class Logger {
  info(message: string, fields: LogFields = {}): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields: LogFields = {}): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields: LogFields = {}): void {
    this.write("error", message, fields);
  }

  private write(level: string, message: string, fields: LogFields): void {
    const fieldText = Object.entries(fields)
      .filter(([key]) => !key.toLowerCase().includes("token") && !key.toLowerCase().includes("apikey"))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ");
    process.stderr.write(`${new Date().toISOString()} level=${level} event=${JSON.stringify(message)}${fieldText ? ` ${fieldText}` : ""}\n`);
  }
}
