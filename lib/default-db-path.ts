import path from "node:path";
import os from "node:os";

export function defaultCursorStateDbPath(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(
      home,
      "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    );
  }
  if (process.platform === "linux") {
    return path.join(home, ".config/Cursor/User/globalStorage/state.vscdb");
  }
  const appData = process.env.APPDATA;
  if (appData) {
    return path.join(appData, "Cursor/User/globalStorage/state.vscdb");
  }
  return path.join(home, "Cursor/User/globalStorage/state.vscdb");
}
