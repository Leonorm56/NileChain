import { Cron } from "croner";

class CronRunner {
  constructor(mode = "sequential") {
    this.mode = mode;
    this.jobs = [];
    this.running = false;
    this.schedulers = [];
    this._stopped = false;
  }

  register(interval, callback, name = "") {
    this.jobs.push({
      interval,
      callback: this.wrapCallback(callback, name),
      name,
    });
  }

  wrapCallback(callback, name) {
    return async () => {
      try {
        console.log(`▶️ Starting: ${name}`);
        await callback();
        console.log(`✅ Finished: ${name}`);
      } catch (err) {
        console.error(`❌ Error in ${name}:`, err);
      }
    };
  }

  /** Sequential mode: run all jobs back-to-back, no fixed interval. */
  async sequentialLoop() {
    while (!this._stopped) {
      this.running = true;
      console.log(
        "🔁 Sequential cycle started at",
        new Date().toLocaleTimeString()
      );

      for (const job of this.jobs) {
        if (this._stopped) break;
        await job.callback();
      }

      this.running = false;
      console.log("🏁 Sequential cycle completed");

      // Small delay between cycles to avoid hammering APIs
      if (!this._stopped) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  start() {
    this._stopped = false;

    if (this.mode === "sequential") {
      console.log("⏱ Running in sequential mode (back-to-back)");
      // Fire and forget — the loop runs continuously
      this.sequentialLoop().catch((err) =>
        console.error("❌ Sequential loop crashed:", err)
      );
    } else {
      console.log("⏱ Running in concurrent mode");
      this.jobs.forEach((job) => {
        this.schedulers.push(new Cron(job.interval, this.wrapConcurrent(job)));
      });
    }
  }

  stop() {
    this._stopped = true;
    this.schedulers.forEach((scheduler) => scheduler.stop());
    this.schedulers = [];
    this.running = false;
    console.log("🛑 All scheduled jobs stopped");
  }

  wrapConcurrent(job) {
    let running = false;
    let pendingReTrigger = false;

    const wrapper = async () => {
      if (running) {
        pendingReTrigger = true;
        console.warn(`⏳ Skipping overlapping job: ${job.name}`);
        return;
      }

      running = true;

      try {
        do {
          pendingReTrigger = false;
          await job.callback();
        } while (pendingReTrigger);
      } finally {
        running = false;
      }
    };

    return wrapper;
  }
}

export default CronRunner;
