/**
 * A deliberate, non-error early stop.
 *
 * Some runs cannot proceed for reasons that are external and expected rather
 * than a fault of the farmer - the drop is in scheduled maintenance, say.
 * Those conditions should end the run quietly: no error notification, no
 * deactivation, no error-count change. Throwing this instead of a plain
 * `Error` lets the runner tell "the drop turned us away for a while" apart
 * from "the farmer broke", while still unwinding the call stack the same way.
 *
 * The `isSkipRun` brand is what the cloud runner checks (rather than
 * `instanceof`), so detection holds even if two copies of this module were
 * ever loaded. It still extends `Error`, so existing `instanceof Error`
 * handling and message logging keep working unchanged.
 */
export default class SkipRun extends Error {
  constructor(message) {
    super(message);
    this.name = "SkipRun";
    this.isSkipRun = true;
  }
}
