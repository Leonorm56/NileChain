import BaseLogger from "./BaseLogger.js";

export default class ConsoleLogger extends BaseLogger {
  /** Output messages to the console (prepends tag when set) */
  output(...args) {
    if (!this.enabled) return;
    if (this.tag) {
      console.log(this.tag, ...args);
    } else {
      console.log(...args);
    }
  }

  /** Clear the console */
  clear() {
    console.clear();
  }
}
